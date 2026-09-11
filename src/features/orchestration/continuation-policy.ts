import type { DoneWhenResult, PlanGraph, PlanNode } from "../../core/orchestration/types";

/**
 * Minimal continuation policy (§H2): when a Plan/Goal run ends while work is
 * explicitly unfinished — stranded pending/ready steps on a failed plan with
 * no hard node failures, or a "completed" plan whose done-when conditions
 * are not met — the harness sends bounded continuation work instead of
 * treating the model's natural finish as task completion.
 *
 * Guards (§H3): a hard attempt cap, a progress signature that must change
 * between attempts (no infinite resuscitation), and the caller's abort
 * signal. Everything the harness decides is emitted to the run trace.
 */
export const MAX_AUTO_CONTINUATIONS = 2;

export const CONTINUATION_INSTRUCTION =
  "Continue from the next incomplete step. Do not repeat completed work.";

/** Nodes the run never executed (never started, never skipped). */
export function incompleteNodes(plan: PlanGraph): PlanNode[] {
  return plan.nodes.filter(({ status }) => status === "pending" || status === "ready");
}

/** Progress fingerprint: which nodes are terminally settled, in which state. */
export function planProgressSignature(plan: PlanGraph): string {
  return plan.nodes
    .map(({ id, status }) => `${id}:${status}`)
    .sort()
    .join("|");
}

/** Progress fingerprint for done-when criteria (label + outcome). */
export function doneWhenSignature(results: readonly DoneWhenResult[]): string {
  return results
    .map(({ label, status }) => `${label}:${status}`)
    .sort()
    .join("|");
}

export type ContinuationReason = "unfinished-nodes" | "unmet-done-when";

export interface ContinuationDecision {
  continue: boolean;
  reason?: ContinuationReason;
  /** Node ids (unfinished-nodes) or unmet condition labels (unmet-done-when). */
  detail: string[];
  instruction: string;
}

/** Unmet executable conditions (manual ones wait for the user, not a retry). */
export function unmetDoneWhenLabels(results: readonly DoneWhenResult[]): string[] {
  return results
    .filter(({ status }) => status === "failed" || status === "pending")
    .map(({ label }) => label);
}

export function decideContinuation(
  plan: PlanGraph,
  doneWhenResults: readonly DoneWhenResult[] | null,
): ContinuationDecision {
  const hardFailed = plan.nodes.some(({ status }) => status === "failed");
  if (plan.status === "failed" && !hardFailed) {
    const nodes = incompleteNodes(plan);
    if (nodes.length > 0) {
      return {
        continue: true,
        reason: "unfinished-nodes",
        detail: nodes.map(({ id }) => id),
        instruction: CONTINUATION_INSTRUCTION,
      };
    }
  }
  if (plan.status === "completed" && doneWhenResults) {
    const unmet = unmetDoneWhenLabels(doneWhenResults);
    if (unmet.length > 0) {
      return {
        continue: true,
        reason: "unmet-done-when",
        detail: unmet,
        instruction: `${CONTINUATION_INSTRUCTION} Unmet conditions: ${unmet.join("; ")}.`,
      };
    }
  }
  return { continue: false, detail: [], instruction: "" };
}

/** The repair step appended for an unmet-done-when continuation. */
export function repairNodeForUnmetDoneWhen(
  unmet: readonly string[],
  attempt: number,
  rootPlan: PlanGraph,
): PlanNode {
  return {
    id: `node-continuation-${attempt}-${rootPlan.nodes.length}`,
    kind: "task",
    title: `Continuation ${attempt}: address unmet done-when conditions`,
    objective: `${CONTINUATION_INSTRUCTION} Unmet conditions: ${unmet.join("; ")}. Fix the underlying work, then verification re-runs automatically.`,
    dependencies: [],
    requiredCapabilities: ["filesystem"],
    resourceScopes: [],
    expectedArtifacts: [],
    successCriteria: unmet.map((label) => `Condition met: ${label}`),
    status: "ready",
  };
}
