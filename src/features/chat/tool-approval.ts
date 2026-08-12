import { continueAgentLoop, type AgentLoopTurn, type AgentMessage } from "./agent-loop";
import type { AgentRunContext } from "../../runtime/types";
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
  agentRun: AgentRunContext;
}

export async function approveTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const ctx = getApprovalContext(pending, set);
  if (!ctx) return;
  const { provider, runtime: baseRuntime } = ctx;
  const runtime = { ...baseRuntime, agentRun: pending.agentRun };
  if (!runtime.toolExecutor) {
    set({ isStreaming: false, error: "tools.notAvailable" });
    return;
  }
  const {
    messages,
    msg: resolvedMsg,
    resolvedTurn,
  } = await executeApproved(pending, runtime, !get().privateSession);
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
    resolvedTurn,
    runtime,
  );
}

export async function denyTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const ctx = getApprovalContext(pending, set);
  if (!ctx) return;
  const { provider, runtime: baseRuntime } = ctx;
  const runtime = { ...baseRuntime, agentRun: pending.agentRun };

  const { resolvedTurn, messages } = buildDenial(pending);
  const resolvedMsg = await persistTurn(
    resolvedTurn,
    pending.conversationId,
    pending.turn.stream.content,
    !get().privateSession,
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
    resolvedTurn,
    runtime,
  );
}
