import type { NodeExecutionResult } from "../../core/orchestration/scheduler";

export type VerificationVerdict = "passed" | "failed" | "partial";

/**
 * Structured verdict for verification nodes.
 *
 * Primary source: the verify prompt requires the model to end its reply with
 * a machine-readable final line `VERIFICATION_STATUS: PASSED|FAILED|PARTIAL`.
 * The legacy natural-language regex ("Verification Result: FAILED") is kept
 * only as a fallback for older plans, never as the primary signal — natural
 * language alone must not decide run state.
 */
export function verificationVerdict(summary: string): VerificationVerdict | null {
  const marker = summary.match(/VERIFICATION_STATUS:\s*\*{0,2}(PASSED|FAILED|PARTIAL)\b/i);
  if (marker?.[1]) return marker[1].toLowerCase() as VerificationVerdict;
  if (/verification result:?\s*\*{0,2}failed/i.test(summary)) return "failed";
  return null;
}

/** Downgrade a completed verification whose verdict says it did not pass. */
export function applyVerificationVerdict(
  node: { kind: string },
  result: NodeExecutionResult,
): NodeExecutionResult {
  if (node.kind !== "verification" || result.status !== "completed") return result;
  const verdict = verificationVerdict(result.summary);
  // PARTIAL is not a pass either (same convention as reportFromLoop, which
  // maps worker "partial" to failed): the run cannot claim completion with
  // explicit unresolved gaps.
  if (verdict === "failed" || verdict === "partial") return { ...result, status: "failed" };
  return result;
}
