import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { taskResolver, type VerificationEvidence } from "../../core/tools/verification-evidence";
import type { SnapshotResult } from "../../runtime/desktop-storage-adapter";
import type { EvirRuntime } from "../../runtime/types";
import { runVerification } from "../../core/tools/verification";
import type { VerificationResult } from "../../core/tools/verification";
import type { FileContextReference } from "../../core/context/types";
import { logger } from "../../core/logging/logger";
import { getStructuredStorage } from "../../runtime/structured-storage";
import type { AgentLoopResult } from "./agent-loop";

export type AgentRunStatus =
  "awaiting_approval" | "completed" | "needs_verification" | "failed" | "cancelled" | "rolled_back";

export interface AgentRunRecord {
  id: string;
  conversationId: string;
  status: AgentRunStatus;
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  snapshots: SnapshotResult[];
  fileReferences: FileContextReference[];
  verificationEvidence: VerificationEvidence[];
  resolution: { complete: boolean; reason: string };
  maxIterationsReached: boolean;
  mode?: import("../../core/providers/tool-registry").InteractionMode;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  createdAt: number;
  updatedAt: number;
}

interface BuildAgentRunOptions {
  previous?: AgentRunRecord | null | undefined;
  runId?: string;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function mergeAgentRunRecords(
  previous: AgentRunRecord | null | undefined,
  current: AgentRunRecord,
): AgentRunRecord {
  if (!previous || previous.id !== current.id || previous.conversationId !== current.conversationId)
    return current;
  const toolCalls = uniqueBy([...previous.toolCalls, ...current.toolCalls], ({ id }) => id);
  const toolResultsByCallId = new Map(
    [...previous.toolResults, ...current.toolResults].map((result) => [result.toolCallId, result]),
  );
  const toolResults = toolCalls.flatMap(({ id }) => {
    const result = toolResultsByCallId.get(id);
    return result ? [result] : [];
  });
  const knownCallIds = new Set(toolCalls.map(({ id }) => id));
  toolResults.push(
    ...[...toolResultsByCallId.values()].filter(({ toolCallId }) => !knownCallIds.has(toolCallId)),
  );
  return {
    ...current,
    toolCalls,
    // Approval continuations reuse the original tool-call id. Map by id so
    // the executed result replaces permission_required without changing the
    // call/result ordering used by persisted tool-execution records.
    toolResults,
    snapshots: uniqueBy(
      [...previous.snapshots, ...current.snapshots],
      ({ snapshot_id }) => snapshot_id,
    ),
    fileReferences: uniqueBy(
      [...previous.fileReferences, ...current.fileReferences],
      ({ path }) => path,
    ),
    verificationEvidence: uniqueBy(
      [...previous.verificationEvidence, ...current.verificationEvidence],
      ({ type, toolName, summary }) => `${type}:${toolName}:${summary}`,
    ),
    createdAt: previous.createdAt,
  };
}

export async function buildAgentRunRecord(
  result: AgentLoopResult,
  conversationId: string,
  runtime?: EvirRuntime,
  options: BuildAgentRunOptions = {},
): Promise<AgentRunRecord> {
  const toolCalls = result.turns.flatMap((turn) => turn.toolCalls ?? []);
  const toolResults = result.turns.flatMap((turn) => turn.toolResults ?? []);
  const lastTurn = result.turns.at(-1);
  const awaitingApproval = result.turns.some((turn) => turn.pendingApproval);
  const modelClaimsComplete =
    !awaitingApproval &&
    !result.maxIterationsReached &&
    lastTurn?.stream.status === "complete" &&
    !lastTurn.stream.toolCalls?.length;
  let verificationEvidence = taskResolver.collectEvidence(toolResults);
  let resolution = taskResolver.resolveTask(verificationEvidence, modelClaimsComplete);
  if (runtime?.harnessMiddlewareRegistry) {
    const completion = await runtime.harnessMiddlewareRegistry.dispatch({
      type: "completion",
      conversationId,
      runId: result.agentRun.id,
      toolResults,
      modelClaimsComplete,
      verificationEvidence: [],
    });
    verificationEvidence = completion.verificationEvidence;
    resolution = completion.resolution ?? {
      complete: false,
      reason: "Verification middleware is disabled or unavailable.",
    };
  }
  const hasFailure = toolResults.some(({ success }) => !success);
  const status: AgentRunStatus = awaitingApproval
    ? "awaiting_approval"
    : lastTurn?.stream.status === "stopped"
      ? "cancelled"
      : hasFailure || lastTurn?.stream.status === "error" || result.maxIterationsReached
        ? "failed"
        : resolution.complete
          ? "completed"
          : "needs_verification";
  const now = Date.now();
  const startedAt = options.previous?.startedAt ?? result.startedAt ?? now;
  const current: AgentRunRecord = {
    id: options.runId ?? result.agentRun.id,
    conversationId,
    status,
    toolCalls,
    toolResults,
    snapshots: [...result.agentRun.snapshots],
    fileReferences: [...result.agentRun.fileReferences],
    verificationEvidence,
    resolution,
    maxIterationsReached: result.maxIterationsReached,
    ...(result.agentRun.startedMode ? { mode: result.agentRun.startedMode } : {}),
    startedAt,
    completedAt: result.completedAt ?? now,
    durationMs: (result.completedAt ?? now) - startedAt,
    createdAt: now,
    updatedAt: now,
  };
  return mergeAgentRunRecords(options.previous, current);
}

export async function persistAgentRun(record: AgentRunRecord): Promise<void> {
  await getStructuredStorage().apply([
    { type: "write", entity: "agent_runs", id: record.id, data: record },
    ...record.toolCalls.map((call) => ({
      type: "write" as const,
      entity: "tool_executions" as const,
      id: `${record.id}:${call.id}`,
      data: {
        id: `${record.id}:${call.id}`,
        runId: record.id,
        conversationId: record.conversationId,
        toolCall: call,
        result: record.toolResults.find(({ toolCallId }) => toolCallId === call.id) ?? null,
        createdAt: record.updatedAt,
      },
    })),
  ]);
}

/**
 * Runs the workspace checker after an agent run that ended needs_verification
 * so a finished run does not wait for a rendered summary component to trigger
 * automatic verification (orchestrated workbench runs never render that
 * component). Only desktop runs with a workspace are eligible; any other
 * status is returned untouched.
 */
export async function finalizeAutomaticVerification(
  record: AgentRunRecord,
  runtime: EvirRuntime,
  runVerificationImpl: (
    workspacePath: string,
    runtime: EvirRuntime,
  ) => Promise<VerificationResult> = runVerification,
): Promise<AgentRunRecord> {
  if (record.status !== "needs_verification") return record;
  if (runtime.target !== "desktop" || !runtime.storage) return record;
  // Answer-only and read-only runs changed nothing; a workspace checker result
  // would be meaningless evidence for them.
  const mutatingTools = new Set([
    "write_file",
    "apply_patch",
    "run_command",
    "create_directory",
    "restore_snapshot",
  ]);
  if (!record.toolResults.some(({ toolName, success }) => success && mutatingTools.has(toolName))) {
    return record;
  }
  const workspace = runtime.getWorkspaceRoot?.();
  if (!workspace) return record;
  const startedAt = Date.now();
  logger.info("agent", "agent.auto-verification-started", {
    conversationId: record.conversationId,
    runId: record.id,
  });
  const verification = await runVerificationImpl(workspace, runtime);
  const updated = applyAutomaticVerification(record, verification);
  logger.info(
    "agent",
    verification.status === "passed"
      ? "agent.auto-verification-passed"
      : "agent.auto-verification-failed",
    {
      conversationId: record.conversationId,
      runId: record.id,
      command: verification.command,
      exitCode: verification.exitCode ?? null,
      durationMs: Date.now() - startedAt,
    },
  );
  if (updated === record) return record;
  await persistAgentRun(updated);
  return updated;
}

export async function rollbackAgentRun(
  record: AgentRunRecord,
  runtime: EvirRuntime,
  persist = true,
): Promise<AgentRunRecord> {
  if (!runtime.storage) throw new Error("Desktop storage is unavailable");
  for (const snapshot of [...record.snapshots].reverse()) {
    await runtime.storage.restoreSnapshot(snapshot.snapshot_id, record.id, snapshot.file_path);
  }
  const rolledBack = { ...record, status: "rolled_back" as const, updatedAt: Date.now() };
  if (persist) await getStructuredStorage().write("agent_runs", rolledBack.id, rolledBack);
  return rolledBack;
}

export function applyAutomaticVerification(
  record: AgentRunRecord,
  verification: VerificationResult,
): AgentRunRecord {
  if (verification.status === "skipped" || verification.status === "cancelled") return record;
  const evidence: VerificationEvidence = {
    type: "command_result",
    toolName: "run_command",
    success: verification.status === "passed",
    summary: `automatic: ${verification.command}: ${verification.status}${verification.exitCode === null ? "" : ` (exit ${verification.exitCode})`}`,
    timestamp: Date.now(),
  };
  const verificationEvidence = [...record.verificationEvidence, evidence];
  const resolution = taskResolver.resolveTask(verificationEvidence, true);
  return {
    ...record,
    verificationEvidence,
    resolution,
    status: resolution.complete ? "completed" : "failed",
    updatedAt: Date.now(),
  };
}
