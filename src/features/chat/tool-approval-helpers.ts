import i18n from "../../i18n/config";
import type { StoreApi } from "zustand";
import {
  db,
  type MessageRecord,
  type ProviderRecord,
  type ToolResultRecord,
} from "../../core/storage/db";
import type { EvirRuntime } from "../../runtime/types";
import { getRuntime } from "../../runtime/use-runtime";
import { TOOL_DENIED } from "../../core/tools/tool-executor";
import { useProviderStore } from "../provider/provider-store";
import { type AgentLoopTurn, type AgentMessage, type AgentLoopResult } from "./agent-loop";
import type { StreamResult } from "./chat-stream";
import type { ChatState } from "./chat-store";
import { toMessage, sorted } from "./chat-helpers";
import type { PendingToolApproval } from "./tool-approval";

export type ChatStoreSet = StoreApi<ChatState>["setState"];
export type ChatStoreGet = StoreApi<ChatState>["getState"];

export function getApprovalContext(
  pending: PendingToolApproval,
  set: ChatStoreSet,
): { provider: ProviderRecord; runtime: EvirRuntime } | null {
  set({ pendingToolApproval: null, isStreaming: true, streamingContent: "", error: null });
  const provider =
    useProviderStore.getState().providers.find((p) => p.id === pending.providerId) ??
    useProviderStore.getState().getDefaultProvider();
  if (!provider) {
    set({ isStreaming: false, error: "chat.noProvider" });
    return null;
  }
  return { provider, runtime: getRuntime() };
}

export async function persistTurn(
  turn: AgentLoopTurn,
  conversationId: string,
  streamContent?: string,
): Promise<MessageRecord> {
  const msg = toMessage(turn, conversationId, streamContent);
  await db.messages.add(msg);
  return msg;
}

export async function updateConversationTimestamp(conversationId: string): Promise<number> {
  const updatedAt = Date.now();
  await db.conversations.update(conversationId, { updatedAt });
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
  messages.push({
    role: "assistant",
    content: turn.stream.content,
    tool_calls: (turn.toolCalls ?? []).map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.toolName, arguments: JSON.stringify(call.arguments) },
    })),
  });
  for (const result of results) {
    messages.push({
      role: "tool",
      content: result.output,
      tool_call_id: result.toolCallId,
      name: result.toolName,
    });
  }
}

export async function executeApproved(
  pending: PendingToolApproval,
  runtime: EvirRuntime,
): Promise<{ messages: AgentMessage[]; msg: MessageRecord }> {
  const approvedResult = await runtime.toolExecutor?.execute(
    pending.toolName,
    pending.args,
    runtime,
    true,
  );
  const replacement: ToolResultRecord = {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    ...(approvedResult ?? {
      success: false,
      output: "Tool executor unavailable",
      error: "unavailable",
    }),
  };
  const results = resolveResults(pending.turn, pending.toolCallId, replacement);
  const messages = [...pending.messages];
  appendResolvedMessages(messages, pending.turn, results);
  const msg = await persistTurn(
    {
      stream: pending.turn.stream,
      ...(pending.turn.toolCalls ? { toolCalls: pending.turn.toolCalls } : {}),
      toolResults: results,
    },
    pending.conversationId,
    pending.turn.stream.content,
  );
  return { messages, msg };
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
): Promise<void> {
  const newTurns = loopResult.turns;
  const newMessages: MessageRecord[] = [];
  for (const turn of newTurns) {
    newMessages.push(await persistTurn(turn, conversationId));
  }
  const updatedAt = await updateConversationTimestamp(conversationId);
  const lastStream: StreamResult | undefined = loopResult.turns.at(-1)?.stream;
  const error = loopResult.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;
  const isNotBlockedMessage = (m: MessageRecord) =>
    !(m.toolCalls?.some((tc) => tc.id === pendingToolCallId) && !m.toolResults?.length);

  set(({ conversations, messages: currentMessages, currentConversationId }) => ({
    conversations: sorted(
      conversations.map((item) => (item.id === conversationId ? { ...item, updatedAt } : item)),
    ),
    ...(currentConversationId === conversationId
      ? { messages: [...currentMessages.filter(isNotBlockedMessage), resolvedMsg, ...newMessages] }
      : {}),
    isStreaming: false,
    streamingContent: "",
    error: error ?? null,
  }));
}
