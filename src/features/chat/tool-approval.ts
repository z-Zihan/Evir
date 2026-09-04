import { continueAgentLoop, type AgentLoopTurn, type AgentMessage } from "./agent-loop";
import type { AgentRunContext, EvirRuntime } from "../../runtime/types";
import type { MessageRecord } from "../../core/storage/db";
import { ToolRegistryImpl } from "../../core/tools/tool-registry-impl";
import { ToolExecutor } from "../../core/tools/tool-executor";
import { logger } from "../../core/logging/logger";
import {
  getApprovalContext,
  persistTurn,
  executeApproved,
  buildDenial,
  finalizeApprovalFlow,
  type ChatStoreSet,
  type ChatStoreGet,
} from "./tool-approval-helpers";
import {
  cancelCurrentRun,
  resolveCurrentApprovalNode,
} from "../orchestration/orchestration-session";
import { useOrchestrationStore } from "../orchestration/orchestration-store";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { createActiveTaskController } from "./chat-stream";
import { activeTraceFor, completeTrace } from "../tracing/trace-recorder";
import {
  finishConversationStream,
  setPendingApproval,
  updateConversationStream,
} from "./stream-ownership";
import { permissionContextForRoot } from "../projects/run-permission";
import type { PermissionContext } from "../../core/security/permission-profiles";
import {
  RISK_LEVELS,
  TOOL_SOURCES,
  type RiskLevel,
  type ToolApprovalDetails,
  type ToolSource,
} from "../../core/providers/tool-registry";
import type { PendingToolApproval } from "./chat-contracts";

export type { PendingToolApproval };

export interface ApprovalRecord {
  id: string;
  runId: string;
  nodeId: string;
  conversationId: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: RiskLevel;
  source?: ToolSource;
  approval?: ToolApprovalDetails;
  messages: AgentMessage[];
  providerId: string;
  turn: AgentLoopTurn;
  agentRun: AgentRunContext;
  mode: "plan" | "goal" | "agent";
  allowedToolIds: string[];
  createdAt: number;
  updatedAt: number;
}

function riskLevelOf(value: unknown): RiskLevel | undefined {
  return typeof value === "string" && RISK_LEVELS.includes(value as RiskLevel)
    ? (value as RiskLevel)
    : undefined;
}

function toolSourceOf(value: unknown): ToolSource | undefined {
  return typeof value === "string" && TOOL_SOURCES.includes(value as ToolSource)
    ? (value as ToolSource)
    : undefined;
}

function approvalDetailsOf(value: unknown): ToolApprovalDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const target = candidate["target"];
  const impact = candidate["impact"];
  const reversible = candidate["reversible"];
  const dataDestination = candidate["dataDestination"];
  if (
    typeof target !== "string" ||
    target.length === 0 ||
    target.length > 1_000 ||
    (impact !== "local-process-access" && impact !== "remote-data-transfer") ||
    typeof reversible !== "boolean" ||
    (dataDestination !== undefined &&
      (typeof dataDestination !== "string" || dataDestination.length > 2_048))
  ) {
    return undefined;
  }
  return {
    target,
    impact,
    reversible,
    ...(typeof dataDestination === "string" ? { dataDestination } : {}),
  };
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
    ...(pending.riskLevel ? { riskLevel: pending.riskLevel } : {}),
    ...(pending.source ? { source: pending.source } : {}),
    ...(pending.approval ? { approval: pending.approval } : {}),
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
  const riskLevel = riskLevelOf(record.riskLevel);
  const source = toolSourceOf(record.source);
  const approval = approvalDetailsOf(record.approval);
  return {
    approvalId: record.id,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    args: record.args,
    ...(riskLevel ? { riskLevel } : {}),
    ...(source ? { source } : {}),
    ...(approval ? { approval } : {}),
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
  // Continuations keep the originating run's permission policy even when the
  // user switched projects between the block and the approval click.
  const permissionContext: PermissionContext | null | undefined =
    pending.workspaceRoot !== undefined
      ? permissionContextForRoot(pending.workspaceRoot)
      : baseRuntime.permissionContext;
  const permissionPatch = permissionContext === undefined ? {} : { permissionContext };
  if (!pending.allowedToolIds) {
    return {
      ...baseRuntime,
      agentRun: pending.agentRun,
      mode: pending.mode ?? "agent",
      ...permissionPatch,
    };
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
    ...permissionPatch,
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
  const next = { ...pending };
  delete next.riskLevel;
  delete next.source;
  delete next.approval;
  return {
    ...next,
    approvalId: crypto.randomUUID(),
    toolCallId: blocked.toolCallId,
    toolName: blocked.toolName,
    args: blocked.args,
    ...(blocked.riskLevel ? { riskLevel: blocked.riskLevel } : {}),
    ...(blocked.source ? { source: blocked.source } : {}),
    ...(blocked.approval ? { approval: blocked.approval } : {}),
    messages,
    turn,
    agentRun,
  };
}

export function approvalContinuationStopped(
  signal: AbortSignal,
  turn: AgentLoopTurn | undefined,
): boolean {
  return signal.aborted || turn?.stream.status === "stopped";
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
        pending.conversationId,
      )
    : false;
  const [next, ...rest] = pending.remainingApprovals ?? [];
  if (next) {
    setPendingApproval(set, get, pending.conversationId, { ...next, remainingApprovals: rest });
    const current = useOrchestrationStore.getState().snapshotFor(next.conversationId);
    if (current && current.runId === next.orchestration?.runId) {
      useOrchestrationStore.getState().setCurrent({ ...current, phase: "paused" });
    }
    return;
  }
  if (shouldContinue) {
    const { continueCurrentExecution } = await import("../orchestration/continue-orchestration");
    await continueCurrentExecution(pending.conversationId);
  }
}

export async function approveTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  return resolveApproval(pending, set, get, "approved");
}

export async function denyTool(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
): Promise<void> {
  return resolveApproval(pending, set, get, "denied");
}

/**
 * Single continuation pipeline for both approval outcomes. The flows are
 * structurally identical; the outcome only changes (a) how the resolved turn
 * is produced (execute vs. denial record), (b) the persisted status — note a
 * STOPPED approve continuation persists "cancelled" while a stopped deny
 * persists "denied" — and (c) the orchestration outcome summary.
 */
async function resolveApproval(
  pending: PendingToolApproval,
  set: ChatStoreSet,
  get: ChatStoreGet,
  outcome: "approved" | "denied",
): Promise<void> {
  const current = get().pendingApprovals?.[pending.conversationId] ?? null;
  const isCurrent =
    current !== null &&
    current.conversationId === pending.conversationId &&
    current.toolCallId === pending.toolCallId &&
    current.approvalId === pending.approvalId;
  if (!isCurrent) return;
  const approved = outcome === "approved";
  const ctx = getApprovalContext(pending, set, get);
  if (!ctx) return;
  logger.info("approval", approved ? "approval.granted" : "approval.denied", {
    conversationId: pending.conversationId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    ...(pending.riskLevel ? { riskLevel: pending.riskLevel } : {}),
    ...(pending.orchestration ? { runId: pending.orchestration.runId } : {}),
  });
  activeTraceFor(pending.conversationId)?.approvalResolved(
    approved ? "granted" : "denied",
    pending.toolCallId,
  );
  const { provider, runtime: baseRuntime, streamStartedAt } = ctx;
  const runtime = approvalRuntime(baseRuntime, pending);
  if (approved && !runtime.toolExecutor) {
    finishConversationStream(set, get, pending.conversationId, streamStartedAt);
    if (get().currentConversationId === pending.conversationId) {
      set({ error: "tools.notAvailable" });
    }
    return;
  }
  const task = createActiveTaskController(pending.conversationId);
  try {
    let resolved: { messages: AgentMessage[]; msg: MessageRecord; resolvedTurn: AgentLoopTurn };
    if (approved) {
      resolved = await executeApproved(pending, runtime, !get().privateSession, task.signal);
    } else {
      const denial = buildDenial(pending);
      const resolvedMsg = await persistTurn(
        denial.resolvedTurn,
        pending.conversationId,
        pending.turn.stream.content,
        !get().privateSession,
      );
      resolved = { messages: denial.messages, msg: resolvedMsg, resolvedTurn: denial.resolvedTurn };
    }
    const { messages, msg: resolvedMsg, resolvedTurn } = resolved;
    const onDelta = (streamingContent: string) =>
      updateConversationStream(set, get, pending.conversationId, streamingContent);
    const loopResult = await continueAgentLoop({
      provider,
      conversationId: pending.conversationId,
      messages,
      runtime,
      onDelta,
      ...(pending.mode ? { mode: pending.mode } : {}),
      signal: task.signal,
    });
    const continuationMessages = await finalizeApprovalFlow(
      set,
      get,
      loopResult,
      resolvedMsg,
      pending.conversationId,
      pending.toolCallId,
      resolvedTurn,
      runtime,
      pending.orchestration?.runId,
    );
    activeTraceFor(pending.conversationId)?.attachMessages(
      continuationMessages.map(({ id }) => id),
    );
    finishConversationStream(set, get, pending.conversationId, streamStartedAt);
    const finalTurn = loopResult.turns.at(-1);
    if (approvalContinuationStopped(task.signal, finalTurn)) {
      completeTrace(pending.conversationId, "stopped");
      await persistApprovalStatus(pending, approved ? "cancelled" : "denied", get().privateSession);
      await cancelCurrentRun(runtime, get().privateSession, pending.conversationId);
      return;
    }
    if (finalTurn) {
      const next = continuedApproval(pending, finalTurn, loopResult.messages, loopResult.agentRun);
      if (next) {
        await persistApprovalStatus(pending, outcome, get().privateSession);
        await persistApprovalStatus(next, "pending", get().privateSession);
        setPendingApproval(set, get, pending.conversationId, next);
        return;
      }
    }
    completeTrace(
      pending.conversationId,
      finalTurn?.stream.status === "complete" && !loopResult.maxIterationsReached
        ? "completed"
        : finalTurn?.stream.status === "stopped"
          ? "stopped"
          : "failed",
    );
    await persistApprovalStatus(pending, outcome, get().privateSession);
    const completed = finalTurn?.stream.status === "complete" && !loopResult.maxIterationsReached;
    await continueOrchestrationAfterApproval(
      pending,
      runtime,
      approved ? (completed ? "completed" : "failed") : "failed",
      finalTurn?.stream.content ||
        (approved ? "Approved tool execution finished" : "Tool approval was denied"),
      set,
      get,
    );
  } catch (error) {
    finishConversationStream(set, get, pending.conversationId, streamStartedAt);
    throw error;
  } finally {
    task.dispose();
  }
}
