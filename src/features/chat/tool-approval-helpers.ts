import i18n from "../../i18n/config";
import type { StoreApi } from "zustand";
import type {
  ConversationRecord,
  MessageRecord,
  ProviderRecord,
  ToolResultRecord,
} from "../../core/storage/db";
import type { EvirRuntime } from "../../runtime/types";
import { getRuntime } from "../../runtime/use-runtime";
import { TOOL_DENIED } from "../../core/tools/tool-executor";
import { popRunRoot, pushRunRoot } from "../../core/workspace/active-root";
import { permissionContextForRoot } from "../projects/run-permission";
import { useProviderStore } from "../provider/provider-store";
import {
  type AgentLoopTurn,
  type AgentMessage,
  type AgentLoopResult,
  assistantToolCallWireMessage,
  toolResultWireMessages,
} from "./agent-loop";
import type { StreamResult } from "./chat-stream";
import type { ChatState } from "./chat-store";
import { toMessage, sorted } from "./chat-helpers";
import type { PendingToolApproval } from "./tool-approval";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { logger } from "../../core/logging/logger";
import {
  buildAgentRunRecord,
  finalizeAutomaticVerification,
  persistAgentRun,
  type AgentRunRecord,
} from "./agent-run-record";
import {
  beginConversationStream,
  finishConversationStream,
  setPendingApproval,
  visibleForConversation,
} from "./stream-ownership";
import { emitWorkspaceToolEvent } from "../workspace/workspace-events";

export type ChatStoreSet = StoreApi<ChatState>["setState"];
export type ChatStoreGet = StoreApi<ChatState>["getState"];

export function getApprovalContext(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): { provider: ProviderRecord; runtime: EvirRuntime; streamStartedAt: number } | null {
  const current = get().pendingApprovals?.[pending.conversationId] ?? null;
  const sameApproval =
    current !== null &&
    current.conversationId === pending.conversationId &&
    current.toolCallId === pending.toolCallId &&
    current.approvalId === pending.approvalId;
  // A delayed click or restored UI must never execute an approval that has
  // already been replaced, denied, cancelled, or resolved.
  if (!sameApproval) return null;
  const streamStartedAt = beginConversationStream(set, get, pending.conversationId);
  setPendingApproval(set, get, pending.conversationId, null);
  const provider =
    useProviderStore.getState().providers.find((p) => p.id === pending.providerId) ??
    useProviderStore.getState().getDefaultProvider();
  if (!provider) {
    finishConversationStream(set, get, pending.conversationId, streamStartedAt);
    if (visibleForConversation(get, pending.conversationId)) set({ error: "chat.noProvider" });
    return null;
  }
  return { provider, runtime: getRuntime(), streamStartedAt };
}

export async function persistTurn(
  turn: AgentLoopTurn,
  conversationId: string,
  streamContent?: string,
  persist = true,
): Promise<MessageRecord> {
  const msg = toMessage(turn, conversationId, streamContent);
  if (persist) await getStructuredStorage().write("messages", msg.id, msg);
  return msg;
}

export async function updateConversationTimestamp(
  conversationId: string,
  persist = true,
): Promise<number> {
  const updatedAt = Date.now();
  if (!persist) return updatedAt;
  const storage = getStructuredStorage();
  const conversation = await storage.read<ConversationRecord>("conversations", conversationId);
  if (conversation) {
    await storage.write("conversations", conversationId, { ...conversation, updatedAt });
  }
  return updatedAt;
}

export function resolveResults(
  turn: AgentLoopTurn,
  toolCallId: string,
  replacement: ToolResultRecord,
): ToolResultRecord[] {
  if (!turn.toolResults?.length) return [replacement];
  const found = turn.toolResults.some((r) => r.toolCallId === toolCallId);
  const mapped = turn.toolResults.map((r) => (r.toolCallId === toolCallId ? replacement : r));
  return found ? mapped : [...mapped, replacement];
}

export function appendResolvedMessages(
  messages: AgentMessage[],
  turn: AgentLoopTurn,
  results: ToolResultRecord[],
): void {
  messages.push(
    assistantToolCallWireMessage(
      turn.stream.content,
      (turn.toolCalls ?? []).map((call) => ({
        id: call.id,
        toolName: call.toolName,
        arguments: JSON.stringify(call.arguments),
      })),
    ),
  );
  messages.push(...toolResultWireMessages(results));
}

export async function executeApproved(
  pending: PendingToolApproval,
  runtime: EvirRuntime,
  persist = true,
  signal?: AbortSignal,
): Promise<{ messages: AgentMessage[]; msg: MessageRecord; resolvedTurn: AgentLoopTurn }> {
  // Rebind the originating run's workspace root so approving later — possibly
  // after the user switched projects — still executes in the original project.
  if (pending.workspaceRoot !== undefined) {
    pushRunRoot(pending.workspaceRoot, permissionContextForRoot(pending.workspaceRoot));
  }
  try {
    return await executeApprovedBound(pending, runtime, persist, signal);
  } finally {
    if (pending.workspaceRoot !== undefined) popRunRoot();
  }
}

async function executeApprovedBound(
  pending: PendingToolApproval,
  runtime: EvirRuntime,
  persist = true,
  signal?: AbortSignal,
): Promise<{ messages: AgentMessage[]; msg: MessageRecord; resolvedTurn: AgentLoopTurn }> {
  const startedAt = Date.now();
  const runId = pending.orchestration?.runId ?? pending.agentRun.id;
  logger.info("tool", "agent.tool-started", {
    conversationId: pending.conversationId,
    runId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    approved: true,
  });
  const snapshotsBefore = runtime.agentRun ? runtime.agentRun.snapshots.length : 0;
  const approvedResult = await runtime.toolExecutor?.execute(
    pending.toolName,
    pending.args,
    runtime,
    true,
    signal,
    {
      conversationId: pending.conversationId,
      runId,
      toolCallId: pending.toolCallId,
    },
  );
  const completedAt = Date.now();
  const replacement: ToolResultRecord = {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    ...(approvedResult ?? {
      success: false,
      output: "Tool executor unavailable",
      error: "unavailable",
    }),
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
  };
  // Approved executions drive the same real-time workspace updates as
  // in-loop executions (write after approval must appear in Changes/Files).
  emitWorkspaceToolEvent({
    conversationId: pending.conversationId,
    runId,
    toolCall: {
      id: pending.toolCallId,
      toolName: pending.toolName,
      arguments: pending.args,
    },
    result: replacement,
    newSnapshots: runtime.agentRun ? runtime.agentRun.snapshots.slice(snapshotsBefore) : [],
  });
  logger.info("tool", "agent.tool-completed", {
    conversationId: pending.conversationId,
    runId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    approved: true,
    success: replacement.success,
    durationMs: replacement.durationMs,
    error: replacement.error ?? null,
  });
  const results = resolveResults(pending.turn, pending.toolCallId, replacement);
  const messages = [...pending.messages];
  appendResolvedMessages(messages, pending.turn, results);
  const resolvedTurn: AgentLoopTurn = {
    stream: pending.turn.stream,
    ...(pending.turn.toolCalls ? { toolCalls: pending.turn.toolCalls } : {}),
    toolResults: results,
  };
  const msg = await persistTurn(
    resolvedTurn,
    pending.conversationId,
    pending.turn.stream.content,
    persist,
  );
  return { messages, msg, resolvedTurn };
}

export function buildDenial(pending: PendingToolApproval): {
  resolvedTurn: AgentLoopTurn;
  messages: AgentMessage[];
} {
  const denied: ToolResultRecord = {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    success: false,
    output: i18n.t("tools.deniedMessage"),
    error: TOOL_DENIED,
  };
  const results = resolveResults(pending.turn, pending.toolCallId, denied);
  const messages = [...pending.messages];
  appendResolvedMessages(messages, pending.turn, results);
  return {
    resolvedTurn: {
      stream: pending.turn.stream,
      ...(pending.turn.toolCalls ? { toolCalls: pending.turn.toolCalls } : {}),
      toolResults: results,
    },
    messages,
  };
}

export async function finalizeApprovalFlow(
  set: ChatStoreSet,
  get: ChatStoreGet,
  loopResult: AgentLoopResult,
  resolvedMsg: MessageRecord,
  conversationId: string,
  pendingToolCallId: string,
  priorTurn: AgentLoopTurn,
  runtime: EvirRuntime,
  orchestrationRunId?: string,
): Promise<void> {
  const persist = !get().privateSession;
  const newTurns = loopResult.turns;
  const newMessages: MessageRecord[] = [];
  for (const turn of newTurns) {
    newMessages.push(await persistTurn(turn, conversationId, undefined, persist));
  }
  const updatedAt = await updateConversationTimestamp(conversationId, persist);
  const lastStream: StreamResult | undefined = loopResult.turns.at(-1)?.stream;
  const error = loopResult.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;
  const fullResult: AgentLoopResult = {
    ...loopResult,
    turns: [priorTurn, ...loopResult.turns],
  };
  const runId = orchestrationRunId ?? fullResult.agentRun.id;
  const previous =
    get().latestAgentRun?.id === runId
      ? get().latestAgentRun
      : persist
        ? await getStructuredStorage().read<AgentRunRecord>("agent_runs", runId)
        : null;
  const agentRunRecord = await buildAgentRunRecord(fullResult, conversationId, runtime, {
    previous,
    runId,
  });
  let finalAgentRun = agentRunRecord;
  if (persist) {
    await persistAgentRun(agentRunRecord);
    finalAgentRun = await finalizeAutomaticVerification(agentRunRecord, runtime);
  }
  const isNotBlockedMessage = (m: MessageRecord) =>
    !(m.toolCalls?.some((tc) => tc.id === pendingToolCallId) && !m.toolResults?.length);

  set(({ conversations, messages: currentMessages, currentConversationId, runOutcomes }) => ({
    conversations: sorted(
      conversations.map((item) => (item.id === conversationId ? { ...item, updatedAt } : item)),
    ),
    runOutcomes: {
      ...runOutcomes,
      [conversationId]: {
        status: error ? "failed" : "completed",
        at: Date.now(),
      },
    },
    ...(currentConversationId === conversationId
      ? { messages: [...currentMessages.filter(isNotBlockedMessage), resolvedMsg, ...newMessages] }
      : {}),
    ...(currentConversationId === conversationId
      ? {
          streamingContent: "",
          error: error ?? null,
          latestAgentRun: finalAgentRun,
        }
      : {}),
  }));
}
