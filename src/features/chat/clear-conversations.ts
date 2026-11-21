import type { MemoryRecord } from "../../core/memory/types";
import type { SettingRecord } from "../../core/storage/db";
import type { EntityName, StorageMutation } from "../../core/storage/storage-port";

type RowWithId = { id: string };

export interface ClearConversationsRows {
  memories: Pick<MemoryRecord, "id" | "type">[];
  settings: SettingRecord[];
  toolExecutions: RowWithId[];
  agentRuns: RowWithId[];
  taskBriefs: RowWithId[];
  plans: RowWithId[];
  runSteps: RowWithId[];
  runEvents: RowWithId[];
  agentAssignments: RowWithId[];
  approvals: RowWithId[];
  artifacts: (RowWithId & { relatedEntityId?: string | null })[];
}

/**
 * Builds the single atomic batch behind "clear all conversations". It mirrors
 * deleteConversation (./conversation-ops.ts) across every conversation: with
 * no conversation left, every conversation-scoped row (tool executions, runs,
 * briefs, plans, run steps/events, assignments, approvals) goes in full.
 * Artifacts with relatedEntityId === null are workspace StoredArtifacts
 * (content-hash cache), not conversation data, and survive as they do there.
 * Rows come from full readAll scans — same order of magnitude as the
 * per-row deletes deleteConversation already issues.
 */
export function buildClearConversationsMutations(rows: ClearConversationsRows): StorageMutation[] {
  const deleteAll = (entity: EntityName, records: RowWithId[]): StorageMutation[] =>
    records.map(({ id }) => ({ type: "delete", entity, id }));
  return [
    { type: "clear", entity: "conversations" },
    { type: "clear", entity: "messages" },
    { type: "clear", entity: "attachments" },
    ...deleteAll("tool_executions", rows.toolExecutions),
    ...deleteAll("agent_runs", rows.agentRuns),
    ...deleteAll("task_briefs", rows.taskBriefs),
    ...deleteAll("plans", rows.plans),
    ...deleteAll("run_steps", rows.runSteps),
    ...deleteAll("run_events", rows.runEvents),
    ...deleteAll("agent_assignments", rows.agentAssignments),
    ...deleteAll("approvals", rows.approvals),
    ...deleteAll(
      "artifacts",
      rows.artifacts.filter(({ relatedEntityId }) => relatedEntityId !== null),
    ),
    ...deleteAll(
      "memories",
      rows.memories.filter(({ type }) => type === "conversation"),
    ),
    ...rows.settings
      .filter(({ name }) => name.startsWith("checkpoint:"))
      .map(({ name }): StorageMutation => ({ type: "delete", entity: "settings", id: name })),
  ];
}
