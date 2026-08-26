import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { taskResolver, type VerificationEvidence } from "../../core/tools/verification-evidence";
import type { SnapshotResult } from "../../runtime/desktop-storage-adapter";
import type { EvirRuntime } from "../../runtime/types";
import type { VerificationResult } from "../../core/tools/verification";
import type { FileContextReference } from "../../core/context/types";
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
  return {
    ...current,
    toolCalls: uniqueBy([...previous.toolCalls, ...current.toolCalls], ({ id }) => id),
    toolResults: uniqueBy(
      [...previous.toolResults, ...current.toolResults],
      ({ toolCallId }) => toolCallId,
    ),
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
    createdAt: now,
    updatedAt: now,
  };
  return mergeAgentRunRecords(options.previous, current);
}

export async function persistAgentRun(record: AgentRunRecord): Promise<void> {
  await getStructuredStorage().apply([
    { type: "write", entity: "agent_runs", id: record.id, data: record },
    ...record.toolCalls.map((call, index) => ({
      type: "write" as const,
      entity: "tool_executions" as const,
      id: `${record.id}:${call.id}`,
      data: {
        id: `${record.id}:${call.id}`,
        runId: record.id,
        conversationId: record.conversationId,
        toolCall: call,
        result: record.toolResults[index] ?? null,
        createdAt: record.updatedAt,
      },
    })),
  ]);
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
