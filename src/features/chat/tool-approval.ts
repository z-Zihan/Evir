import { continueAgentLoop, type AgentLoopTurn, type AgentMessage } from "./agent-loop";
import type { AgentRunContext, EvirRuntime } from "../../runtime/types";
import { ToolRegistryImpl } from "../../core/tools/tool-registry-impl";
import { ToolExecutor } from "../../core/tools/tool-executor";
import {
  getApprovalContext,
  persistTurn,
  executeApproved,
  buildDenial,
  finalizeApprovalFlow,
  type ChatStoreSet,
  type ChatStoreGet,
} from "./tool-approval-helpers";
import { resolveCurrentApprovalNode } from "../orchestration/orchestration-session";
import { useOrchestrationStore } from "../orchestration/orchestration-store";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { createActiveTaskController } from "./chat-stream";

export interface PendingToolApproval {
  approvalId?: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  conversationId: string;
  messages: AgentMessage[];
  providerId: string;
  turn: AgentLoopTurn;
  agentRun: AgentRunContext;
  mode?: "plan" | "agent";
  allowedToolIds?: string[];
  orchestration?: { runId: string; nodeId: string };
  remainingApprovals?: PendingToolApproval[];
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  nodeId: string;
  conversationId: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  messages: AgentMessage[];
  providerId: string;
  turn: AgentLoopTurn;
  agentRun: AgentRunContext;
  mode: "plan" | "agent";
  allowedToolIds: string[];
  createdAt: number;
  updatedAt: number;
}

export function toApprovalRecord(
  pending: PendingToolApproval,
  status: ApprovalRecord["status"] = "pending",
): ApprovalRecord {
  const now = Date.now();
  return {
    id: pending.approvalId ?? crypto.randomUUID(),
    runId: pending.orchestration?.runId ?? pending.agentRun.id,
    nodeId: pending.orchestration?.nodeId ?? "legacy-agent-loop",
    conversationId: pending.conversationId,
    status,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    args: pending.args,
    messages: pending.messages,
    providerId: pending.providerId,
    turn: pending.turn,
    agentRun: pending.agentRun,
    mode: pending.mode ?? "agent",
    allowedToolIds: pending.allowedToolIds ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function fromApprovalRecord(record: ApprovalRecord): PendingToolApproval {
  return {
    approvalId: record.id,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    args: record.args,
    conversationId: record.conversationId,
    messages: record.messages,
    providerId: record.providerId,
    turn: record.turn,
    agentRun: record.agentRun,
    mode: record.mode,
    allowedToolIds: record.allowedToolIds,
    ...(record.nodeId !== "legacy-agent-loop"
      ? { orchestration: { runId: record.runId, nodeId: record.nodeId } }
      : {}),
  };
}

async function persistApprovalStatus(
  pending: PendingToolApproval,
  status: ApprovalRecord["status"],
  privateSession: boolean,
): Promise<void> {
  if (privateSession) return;
  const record = toApprovalRecord(pending, status);
  const previous = await getStructuredStorage().read<ApprovalRecord>("approvals", record.id);
  await getStructuredStorage().write("approvals", record.id, {
    ...record,
    createdAt: previous?.createdAt ?? record.createdAt,
  });
}

export async function cancelPendingToolApprovals(
  pending: PendingToolApproval | null,
  privateSession: boolean,
): Promise<void> {
  if (!pending) return;
  await Promise.all(
    [pending, ...(pending.remainingApprovals ?? [])].map((approval) =>
      persistApprovalStatus(approval, "cancelled", privateSession),
    ),
  );
}

function approvalRuntime(baseRuntime: EvirRuntime, pending: PendingToolApproval): EvirRuntime {
  if (!pending.allowedToolIds) {
    return { ...baseRuntime, agentRun: pending.agentRun, mode: pending.mode ?? "agent" };
  }
  const allowed = new Set(pending.allowedToolIds);
  const registry = new ToolRegistryImpl();
  for (const tool of baseRuntime.toolRegistry?.list() ?? []) {
    if (allowed.has(tool.id)) registry.register(tool);
  }
  return {
    ...baseRuntime,
    mode: pending.mode ?? "agent",
    toolRegistry: registry,
    toolExecutor: new ToolExecutor(registry),
    agentRun: pending.agentRun,
  };
}

function continuedApproval(
  pending: PendingToolApproval,
  turn: AgentLoopTurn,
  messages: AgentMessage[],
  agentRun: AgentRunContext,
): PendingToolApproval | null {
  const blocked = turn.pendingApproval;
  if (!blocked) return null;
  return {
    ...pending,
    approvalId: crypto.randomUUID(),
    toolCallId: blocked.toolCallId,
    toolName: blocked.toolName,
    args: blocked.args,
    messages,
    turn,
    agentRun,
  };
}

async function continueOrchestrationAfterApproval(
  pending: PendingToolApproval,
  runtime: EvirRuntime,
  outcome: "completed" | "failed",
  summary: string,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const shouldContinue = pending.orchestration
    ? await resolveCurrentApprovalNode(
        runtime,
        get().privateSession,
        pending.orchestration.nodeId,
        outcome,
        summary,
      )
    : false;
  const [next, ...rest] = pending.remainingApprovals ?? [];
  if (next) {
    set({ pendingToolApproval: { ...next, remainingApprovals: rest }, isStreaming: false });
    const current = useOrchestrationStore.getState().current;
    if (current && current.runId === next.orchestration?.runId) {
      useOrchestrationStore.getState().setCurrent({ ...current, phase: "paused" });
    }
    return;
  }
  if (shouldContinue) {
    const { continueCurrentExecution } = await import("../orchestration/continue-orchestration");
    await continueCurrentExecution();
  }
}

export async function approveTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const ctx = getApprovalContext(pending, set);
  if (!ctx) return;
  const { provider, runtime: baseRuntime } = ctx;
  const runtime = approvalRuntime(baseRuntime, pending);
  if (!runtime.toolExecutor) {
    set({ isStreaming: false, error: "tools.notAvailable" });
    return;
  }
  const task = createActiveTaskController();
  try {
    const {
      messages,
      msg: resolvedMsg,
      resolvedTurn,
    } = await executeApproved(pending, runtime, !get().privateSession, task.signal);
    const onDelta = (streamingContent: string) => set({ streamingContent });
    const loopResult = await continueAgentLoop({
      provider,
      conversationId: pending.conversationId,
      messages,
      runtime,
      onDelta,
      ...(pending.mode ? { mode: pending.mode } : {}),
      signal: task.signal,
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
    const finalTurn = loopResult.turns.at(-1);
    if (finalTurn) {
      const next = continuedApproval(pending, finalTurn, loopResult.messages, loopResult.agentRun);
      if (next) {
        await persistApprovalStatus(pending, "approved", get().privateSession);
        await persistApprovalStatus(next, "pending", get().privateSession);
        set({ pendingToolApproval: next, isStreaming: false });
        return;
      }
    }
    await persistApprovalStatus(pending, "approved", get().privateSession);
    const completed = finalTurn?.stream.status === "complete" && !loopResult.maxIterationsReached;
    await continueOrchestrationAfterApproval(
      pending,
      runtime,
      completed ? "completed" : "failed",
      finalTurn?.stream.content || "Approved tool execution finished",
      set,
      get,
    );
  } finally {
    task.dispose();
  }
}

export async function denyTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  const ctx = getApprovalContext(pending, set);
  if (!ctx) return;
  const { provider, runtime: baseRuntime } = ctx;
  const runtime = approvalRuntime(baseRuntime, pending);
  const task = createActiveTaskController();
  try {
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
      ...(pending.mode ? { mode: pending.mode } : {}),
      signal: task.signal,
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
    const finalTurn = loopResult.turns.at(-1);
    if (finalTurn) {
      const next = continuedApproval(pending, finalTurn, loopResult.messages, loopResult.agentRun);
      if (next) {
        await persistApprovalStatus(pending, "denied", get().privateSession);
        await persistApprovalStatus(next, "pending", get().privateSession);
        set({ pendingToolApproval: next, isStreaming: false });
        return;
      }
    }
    await persistApprovalStatus(pending, "denied", get().privateSession);
    await continueOrchestrationAfterApproval(
      pending,
      runtime,
      "failed",
      finalTurn?.stream.content || "Tool approval was denied",
      set,
      get,
    );
  } finally {
    task.dispose();
  }
}
