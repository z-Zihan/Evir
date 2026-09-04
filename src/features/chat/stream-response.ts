import i18n from "../../i18n/config";
import type { StoreApi } from "zustand";
import type { MessageRecord, ProviderRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";
import type { ChatState } from "./chat-contracts";
import {
  createActiveTaskController,
  providerReadinessError,
  streamAssistant,
  type StreamResult,
} from "./chat-stream";
import type { EvirRuntime } from "../../runtime/types";
import type { PendingToolApproval } from "./tool-approval";
import { toMessage } from "./chat-helpers";
import { TOOL_DENIED } from "../../core/tools/tool-executor";
import { activeTraceFor, beginTrace, completeTrace } from "../tracing/trace-recorder";
import { runOrchestratedAgent } from "../orchestration/run-orchestrated-agent";
import { useOrchestrationStore } from "../orchestration/orchestration-store";
import {
  beginConversationStream,
  beginConversationVerification,
  finishConversationStream,
  updateConversationStream,
  visibleForConversation,
} from "./stream-ownership";
import { prepareTurn } from "./turn/prepare-turn";
import {
  finalizeCompletedTurn,
  persistApprovalWait,
  persistResponse,
  titleFor,
  type ApprovalContext,
} from "./turn/persist-turn";
import { verifyTurn } from "./turn/verify-turn";
import type { TurnContext } from "./turn/turn-state";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];
type ProviderMessage = { role: string; content: unknown };

/**
 * Ask 模式没有工具：模型仍返回 tool_calls 时内容为空，给出可理解的解释而不是空白回复。
 */
export function explainToolCallWithoutAccess(stream: StreamResult): StreamResult {
  const unusableToolCalls = stream.toolCalls ?? [];
  if (unusableToolCalls.length === 0 || stream.content.trim()) return stream;
  const toolNames = [...new Set(unusableToolCalls.map(({ toolName }) => toolName))].join(", ");
  return { ...stream, content: i18n.t("chat.toolCallWithoutToolAccess", { toolNames }) };
}

export async function streamResponse(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
  runtime: EvirRuntime,
  explicitlySelectedSkillIds: ReadonlySet<string> = new Set<string>(),
): Promise<void> {
  const provider = useProviderStore.getState().getDefaultProvider();
  if (!provider) return set({ error: "chat.noProvider" });
  const readinessError = providerReadinessError(provider);
  if (readinessError) return set({ error: readinessError });

  const streamStartedAt = beginConversationStream(set, get, conversationId);
  try {
    await runTurn(
      set,
      get,
      history,
      conversationId,
      runtime,
      provider,
      explicitlySelectedSkillIds,
      streamStartedAt,
    );
  } catch (error) {
    // A persistence/harness failure must not leave the composer wedged in the
    // streaming state; raw message text follows the lastStream?.errorMessage
    // precedent (i18next renders unknown keys verbatim).
    completeTrace(conversationId, "failed");
    if (visibleForConversation(get, conversationId)) {
      set({ error: error instanceof Error ? error.message : "chat.streamFailed" });
    }
  } finally {
    finishConversationStream(set, get, conversationId, streamStartedAt);
  }
}

/**
 * One assistant turn, sequenced through its lifecycle phases:
 * prepare → execute → (approval wait | verify → persist).
 */
async function runTurn(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
  runtime: EvirRuntime,
  provider: ProviderRecord,
  explicitlySelectedSkillIds: ReadonlySet<string>,
  streamStartedAt: number,
): Promise<void> {
  const lastUserMessage = [...history].reverse().find((message) => message.role === "user");
  const conversation = get().conversations.find(({ id }) => id === conversationId);
  const turn: TurnContext = {
    set,
    get,
    history,
    conversationId,
    runtime,
    provider,
    streamStartedAt,
    lastUserMessage,
    conversation,
    explicitlySelectedSkillIds,
  };

  // One trace per assistant turn (§19-20): spans requests, tools and approval
  // waits for the whole response, including agent-loop iterations. The
  // recorder is registered per conversation; deep call sites append via
  // activeTraceFor without threading parameters.
  beginTrace(conversationId, {
    providerId: provider.id,
    modelId: provider.modelId,
    mode: get().mode,
    persist: !get().privateSession,
  });

  const prepared = await prepareTurn(turn);
  if (prepared.blocked) {
    if (visibleForConversation(get, conversationId)) set({ error: prepared.reason });
    completeTrace(conversationId, "failed");
    return;
  }
  const { mode, messages } = prepared.turn;

  const result = await executeTurn(turn, mode, messages);
  if (result.turns.length === 0) {
    // A user denial (or stop) deliberately ends the run here; surfacing the
    // generic "stream ended unexpectedly" error for it would be wrong.
    const recent = get()
      .messages.filter((m) => m.conversationId === conversationId)
      .slice(-8);
    const endedByDenial = recent.some((m) =>
      m.toolResults?.some(({ error }) => error === TOOL_DENIED),
    );
    const snapshot = useOrchestrationStore.getState().snapshotFor(conversationId);
    const endedByCancel =
      snapshot?.phase === "finished" &&
      (snapshot.plan?.status === "cancelled" || snapshot.plan?.status === "failed");
    if (!endedByDenial && !endedByCancel && visibleForConversation(get, conversationId)) {
      set({ error: "chat.streamEnded" });
    }
    completeTrace(conversationId, endedByDenial || endedByCancel ? "stopped" : "failed");
    return;
  }

  const { pendingApprovals, approvalContexts } = collectApprovals(turn, result);
  if (pendingApprovals.length > 0 && (mode === "agent" || mode === "goal")) {
    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });
    return;
  }
  await completeTurn(turn, { mode, result, history });
}

/** executeTurn — provider request, streaming, tool calls, loop control. */
async function executeTurn(
  turn: TurnContext,
  mode: ChatState["mode"],
  messages: ProviderMessage[],
): Promise<AgentLoopResult> {
  const { get, set, conversationId, runtime, provider } = turn;
  const onDelta = (streamingContent: string) =>
    updateConversationStream(set, get, conversationId, streamingContent);
  if (mode === "agent" || mode === "goal" || mode === "plan") {
    const task = createActiveTaskController(conversationId);
    try {
      const orchestration = useOrchestrationStore.getState().snapshotFor(conversationId);
      if (
        (mode === "agent" || mode === "goal") &&
        orchestration?.conversationId === conversationId &&
        orchestration.phase === "execution"
      ) {
        return await runOrchestratedAgent({
          provider,
          conversationId,
          messages,
          runtime,
          privateSession: get().privateSession,
          onDelta,
          signal: task.signal,
        });
      }
      return await runAgentLoop({
        provider,
        conversationId,
        messages,
        runtime,
        onDelta,
        mode,
        signal: task.signal,
      });
    } finally {
      task.dispose();
    }
  }
  // Ask-mode hang protection: generous wall clock so slow models stay usable,
  // but a dead connection surfaces as a timeout instead of spinning forever.
  const ASK_STREAM_TIMEOUT_MS = 300_000;
  const stream = await streamAssistant(
    provider,
    conversationId,
    messages,
    onDelta,
    undefined,
    undefined,
    ASK_STREAM_TIMEOUT_MS,
  );
  return {
    turns: [{ stream: explainToolCallWithoutAccess(stream) }],
    maxIterationsReached: false,
    messages: [],
    agentRun: { id: crypto.randomUUID(), snapshots: [], fileReferences: [] },
  };
}

interface CollectedApprovals {
  pendingApprovals: PendingToolApproval[];
  approvalContexts: ApprovalContext[];
}

function collectApprovals(turn: TurnContext, result: AgentLoopResult): CollectedApprovals {
  const { runtime, conversationId, provider } = turn;
  const lastTurn = result.turns[result.turns.length - 1];
  const approvalContexts =
    result.approvalContexts ??
    (lastTurn?.pendingApproval
      ? [
          {
            runId: "",
            nodeId: "",
            mode: "agent" as const,
            allowedToolIds: runtime.toolRegistry?.listForMode("agent").map(({ id }) => id) ?? [],
            messages: result.messages,
            turn: lastTurn,
            agentRun: result.agentRun,
          },
        ]
      : []);
  const pendingApprovals = approvalContexts.flatMap((context) => {
    const blocked = context.turn.pendingApproval;
    if (!blocked) return [];
    return [
      {
        approvalId: crypto.randomUUID(),
        toolCallId: blocked.toolCallId,
        toolName: blocked.toolName,
        args: blocked.args,
        ...(blocked.riskLevel ? { riskLevel: blocked.riskLevel } : {}),
        ...(blocked.source ? { source: blocked.source } : {}),
        ...(blocked.approval ? { approval: blocked.approval } : {}),
        ...(blocked.workspaceRoot !== undefined ? { workspaceRoot: blocked.workspaceRoot } : {}),
        conversationId,
        messages: context.messages,
        providerId: provider.id,
        turn: context.turn,
        agentRun: context.agentRun,
        ...(context.mode !== "ask" ? { mode: context.mode } : {}),
        allowedToolIds: context.allowedToolIds,
        ...(context.runId && context.nodeId
          ? { orchestration: { runId: context.runId, nodeId: context.nodeId } }
          : {}),
      } satisfies PendingToolApproval,
    ];
  });
  return { pendingApprovals, approvalContexts };
}

async function completeTurn(
  turn: TurnContext,
  args: { mode: ChatState["mode"]; result: AgentLoopResult; history: MessageRecord[] },
): Promise<void> {
  const { set, get, conversationId, runtime, conversation, streamStartedAt } = turn;
  const { mode, result, history } = args;
  const messageTimestamp = Date.now();
  const assistants = result.turns.map((loopTurn, index) =>
    toMessage(loopTurn, conversationId, undefined, messageTimestamp + index),
  );
  const title = titleFor(history, Boolean(conversation?.title));
  const updatedAt = get().privateSession
    ? Date.now()
    : await persistResponse(assistants, conversationId, title);
  const lastStream: StreamResult | undefined = result.turns.at(-1)?.stream;
  const error = result.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;
  activeTraceFor(conversationId)?.attachMessages(assistants.map(({ id }) => id));
  completeTrace(conversationId, traceStatusFor(result, error));

  const agentRunRecord = await verifyTurn(turn, result, runtime, mode);
  finalizeCompletedTurn(turn, {
    assistants,
    title,
    updatedAt,
    error: error ?? null,
    agentRunRecord,
    lastStreamStatus: lastStream?.status,
  });
}

/** Map the loop outcome onto the trace's terminal status. */
function traceStatusFor(
  result: AgentLoopResult,
  error: string | undefined,
): "completed" | "failed" | "stopped" {
  if (result.turns.at(-1)?.stream.status === "stopped") return "stopped";
  return error ? "failed" : "completed";
}
