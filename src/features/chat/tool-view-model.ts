import { TOOL_DENIED, TOOL_PERMISSION_REQUIRED } from "../../core/tools/tool-executor";
import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";

/**
 * Unified presentation state for a tool call (§ AI Elements adaptation).
 * Derived deterministically from persisted runtime records — never from
 * message text. UI layers style/i18n from this; the mapping lives here so
 * AgentActivity, summaries, and future surfaces cannot drift.
 */
export type EvirToolStatus =
  "pending" | "running" | "waiting-approval" | "completed" | "failed" | "denied" | "blocked";

/** Loop/harness block codes that mean "the run itself stopped this call". */
const BLOCKED_ERRORS = new Set([
  "tool_not_allowed",
  "maxIterations",
  "tools.notAllowedByStep",
  "repeated-failed-call",
  "loop-detected",
  "tool_cancelled",
]);

export function deriveToolStatus(
  call: Pick<ToolCallRecord, "id">,
  result: ToolResultRecord | undefined,
  isStreaming: boolean,
): EvirToolStatus {
  if (!result) return isStreaming ? "running" : "pending";
  if (result.error === TOOL_PERMISSION_REQUIRED) return "waiting-approval";
  if (result.error === TOOL_DENIED) return "denied";
  if (result.error && BLOCKED_ERRORS.has(result.error)) return "blocked";
  if (!result.success) return "failed";
  void call;
  return "completed";
}

/** Terminal statuses collapse into prior failed attempts (retry folding). */
export function isTerminalToolStatus(status: EvirToolStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "denied" ||
    status === "blocked" ||
    status === "waiting-approval"
  );
}
