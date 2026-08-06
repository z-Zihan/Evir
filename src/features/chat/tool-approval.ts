import { continueAgentLoop, type AgentLoopTurn, type AgentMessage } from "./agent-loop";
import {
  getApprovalContext,
  persistTurn,
  executeApproved,
  buildDenial,
  finalizeApprovalFlow,
  type ChatStoreSet,
  type ChatStoreGet,
} from "./tool-approval-helpers";

export interface PendingToolApproval {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  conversationId: string;
  messages: AgentMessage[];
  providerId: string;
  turn: AgentLoopTurn;
}

export async function approveTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const ctx = getApprovalContext(pending, set);
  if (!ctx) return;
  const { provider, runtime } = ctx;
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
  await finalizeApprovalFlow(
    set,
    get,
    loopResult,
    resolvedMsg,
    pending.conversationId,
    pending.toolCallId,
  );
}

export async function denyTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const ctx = getApprovalContext(pending, set);
  if (!ctx) return;
  const { provider, runtime } = ctx;

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
  await finalizeApprovalFlow(
    set,
    get,
    loopResult,
    resolvedMsg,
    pending.conversationId,
    pending.toolCallId,
  );
}
