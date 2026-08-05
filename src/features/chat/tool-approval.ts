import type { StoreApi } from "zustand";
import { db, type MessageRecord, type ToolResultRecord } from "../../core/storage/db";
import type { EvirRuntime } from "../../runtime/types";
import { useProviderStore } from "../provider/provider-store";
import {
  continueAgentLoop,
  type AgentLoopTurn,
  type AgentMessage,
  type AgentLoopResult,
} from "./agent-loop";
import type { StreamResult } from "./chat-stream";
import type { ChatState } from "./chat-store";

export interface PendingToolApproval {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  conversationId: string;
  messages: AgentMessage[];
  providerId: string;
  turn: AgentLoopTurn;
}

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

function toMessage(turn: AgentLoopTurn, conversationId: string, content?: string): MessageRecord {
  return {
    id: crypto.randomUUID(),
    conversationId,
    role: "assistant",
    content: content ?? turn.stream.content,
    status: turn.stream.status,
    ...(turn.stream.errorMessage ? { errorMessage: turn.stream.errorMessage } : {}),
    ...(turn.toolCalls?.length ? { toolCalls: turn.toolCalls } : {}),
    ...(turn.toolResults?.length ? { toolResults: turn.toolResults } : {}),
    createdAt: Date.now(),
  };
}

function sorted(conversations: ChatState["conversations"]): ChatState["conversations"] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function persistTurn(
  turn: AgentLoopTurn,
  conversationId: string,
  streamContent?: string,
): Promise<MessageRecord> {
  const msg = toMessage(turn, conversationId, streamContent);
  await db.messages.add(msg);
  return msg;
}

async function updateConversationTimestamp(conversationId: string): Promise<number> {
  const updatedAt = Date.now();
  await db.conversations.update(conversationId, { updatedAt });
  return updatedAt;
}

function resolveResults(
  turn: AgentLoopTurn,
  toolCallId: string,
  replacement: ToolResultRecord,
): ToolResultRecord[] {
  if (!turn.toolResults) return [replacement];
  return turn.toolResults.map((r) => (r.toolCallId === toolCallId ? replacement : r));
}

function appendResolvedMessages(
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
      function: {
        name: call.toolName,
        arguments: JSON.stringify(call.arguments),
      },
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

async function executeApproved(
  pending: PendingToolApproval,
  runtime: EvirRuntime,
): Promise<{ resolvedTurn: AgentLoopTurn; messages: AgentMessage[]; msg: MessageRecord }> {
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
  const resolvedTurn: AgentLoopTurn = {
    stream: pending.turn.stream,
    ...(pending.turn.toolCalls ? { toolCalls: pending.turn.toolCalls } : {}),
    toolResults: results,
  };
  const msg = await persistTurn(resolvedTurn, pending.conversationId, pending.turn.stream.content);
  return { resolvedTurn, messages, msg };
}

function buildDenial(pending: PendingToolApproval): {
  resolvedTurn: AgentLoopTurn;
  messages: AgentMessage[];
} {
  const denied: ToolResultRecord = {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    success: false,
    output: "Tool execution denied by user",
    error: "tool_denied",
  };
  const results = resolveResults(pending.turn, pending.toolCallId, denied);
  const messages = [...pending.messages];
  appendResolvedMessages(messages, pending.turn, results);
  const resolvedTurn: AgentLoopTurn = {
    stream: pending.turn.stream,
    ...(pending.turn.toolCalls ? { toolCalls: pending.turn.toolCalls } : {}),
    toolResults: results,
  };
  return { resolvedTurn, messages };
}

async function finalizeApprovalFlow(
  set: ChatStoreSet,
  get: ChatStoreGet,
  loopResult: AgentLoopResult,
  resolvedMsg: MessageRecord,
  conversationId: string,
): Promise<void> {
  const newTurns = loopResult.turns;
  const newMessages: MessageRecord[] = [];
  if (newTurns.length > 0) {
    const resolvedTurnMsg = loopResult.turns[0]?.stream.content
      ? await persistTurn(
          { stream: loopResult.turns[0].stream },
          conversationId,
          loopResult.turns[0].stream.content,
        )
      : undefined;
    if (resolvedTurnMsg) newMessages.push(resolvedTurnMsg);
    for (let i = 1; i < newTurns.length; i += 1) {
      const msg = await persistTurn(newTurns[i]!, conversationId);
      newMessages.push(msg);
    }
  }
  const updatedAt = await updateConversationTimestamp(conversationId);
  const lastStream: StreamResult | undefined = loopResult.turns.at(-1)?.stream;
  const error = loopResult.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;

  set(({ conversations, messages: currentMessages, currentConversationId }) => ({
    conversations: sorted(
      conversations.map((item) => (item.id === conversationId ? { ...item, updatedAt } : item)),
    ),
    ...(currentConversationId === conversationId
      ? { messages: [...currentMessages, resolvedMsg, ...newMessages] }
      : {}),
    isStreaming: false,
    streamingContent: "",
    error: error ?? null,
  }));
}

export async function approveTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  set({ pendingToolApproval: null, isStreaming: true, streamingContent: "", error: null });
  const provider =
    useProviderStore.getState().providers.find((p) => p.id === pending.providerId) ??
    useProviderStore.getState().getDefaultProvider();
  if (!provider) {
    set({ isStreaming: false, error: "chat.noProvider" });
    return;
  }

  const { getRuntime } = await import("../../runtime/use-runtime");
  const runtime = getRuntime();
  if (!runtime.toolExecutor) {
    set({ isStreaming: false, error: "tools.notAvailable" });
    return;
  }

  const { messages, msg: resolvedMsg } = await executeApproved(pending, runtime);
  const onDelta = (streamingContent: string) => set({ streamingContent });
  const loopResult = await continueAgentLoop({
    provider,
    conversationId: pending.conversationId,
    messages,
    runtime,
    onDelta,
  });
  await finalizeApprovalFlow(set, get, loopResult, resolvedMsg, pending.conversationId);
}

export async function denyTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  set({ pendingToolApproval: null, isStreaming: true, streamingContent: "", error: null });
  const provider =
    useProviderStore.getState().providers.find((p) => p.id === pending.providerId) ??
    useProviderStore.getState().getDefaultProvider();
  if (!provider) {
    set({ isStreaming: false, error: "chat.noProvider" });
    return;
  }

  const { getRuntime } = await import("../../runtime/use-runtime");
  const runtime = getRuntime();

  const { resolvedTurn, messages } = buildDenial(pending);
  const resolvedMsg = await persistTurn(
    resolvedTurn,
    pending.conversationId,
    pending.turn.stream.content,
  );

  const onDelta = (streamingContent: string) => set({ streamingContent });
  const loopResult = await continueAgentLoop({
    provider,
    conversationId: pending.conversationId,
    messages,
    runtime,
    onDelta,
  });
  await finalizeApprovalFlow(set, get, loopResult, resolvedMsg, pending.conversationId);
}
