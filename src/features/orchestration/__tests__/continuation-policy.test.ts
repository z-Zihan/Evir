import { describe, expect, it } from "vitest";
import type { DoneWhenResult, PlanGraph } from "../../../core/orchestration/types";
import {
  CONTINUATION_INSTRUCTION,
  MAX_AUTO_CONTINUATIONS,
  decideContinuation,
  doneWhenSignature,
  incompleteNodes,
  planProgressSignature,
  repairNodeForUnmetDoneWhen,
  unmetDoneWhenLabels,
} from "../continuation-policy";

function planOf(
  status: PlanGraph["status"],
  nodes: Array<[string, PlanGraph["nodes"][number]["status"]]>,
) {
  return {
    id: "p",
    runId: "r",
    conversationId: "c",
    briefVersion: 1,
    revision: 1,
    nodes: nodes.map(([id, nodeStatus]) => ({
      id,
      kind: "task" as const,
      title: id,
      objective: id,
      dependencies: [],
      requiredCapabilities: [],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: [],
      status: nodeStatus,
    })),
    edges: [],
    status,
    requiresConfirmation: false,
    createdAt: 1,
    updatedAt: 1,
  } satisfies PlanGraph;
}

const doneWhen = (labels: string[], statuses: string[]): DoneWhenResult[] =>
  labels.map(
    (label, index) =>
      ({
        label,
        kind: "command",
        status: statuses[index],
      }) as DoneWhenResult,
  );

describe("continuation policy", () => {
  it("caps auto continuations at a small bound", () => {
    expect(MAX_AUTO_CONTINUATIONS).toBeLessThanOrEqual(3);
    expect(MAX_AUTO_CONTINUATIONS).toBeGreaterThan(0);
  });

  it("continues a failed plan that still has unexecuted steps and no hard failures", () => {
    const plan = planOf("failed", [
      ["a", "completed"],
      ["b", "pending"],
      ["c", "ready"],
    ]);
    const decision = decideContinuation(plan, null);
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe("unfinished-nodes");
    expect(decision.detail).toEqual(["b", "c"]);
    expect(decision.instruction).toBe(CONTINUATION_INSTRUCTION);
  });

  it("does not continue hard failures (that is auto-replan territory) or finished plans", () => {
    expect(
      decideContinuation(
        planOf("failed", [
          ["a", "failed"],
          ["b", "pending"],
        ]),
        null,
      ).continue,
    ).toBe(false);
    expect(decideContinuation(planOf("completed", [["a", "completed"]]), null).continue).toBe(
      false,
    );
    expect(decideContinuation(planOf("failed", [["a", "completed"]]), null).continue).toBe(false);
  });

  it("continues a completed plan whose executable done-when criteria are unmet", () => {
    const plan = planOf("completed", [["a", "completed"]]);
    const results = doneWhen(["tests pass", "review done"], ["failed", "manual"]);
    const decision = decideContinuation(plan, results);
    expect(decision.reason).toBe("unmet-done-when");
    // Manual criteria wait for the user — only failed/pending ones drive a repair.
    expect(decision.detail).toEqual(["tests pass"]);
  });

  it("signatures detect progress (or its absence)", () => {
    const before = planOf("failed", [
      ["a", "completed"],
      ["b", "pending"],
    ]);
    const progressed = planOf("completed", [
      ["a", "completed"],
      ["b", "completed"],
    ]);
    expect(planProgressSignature(before)).not.toBe(planProgressSignature(progressed));
    expect(planProgressSignature(before)).toBe(
      planProgressSignature(
        planOf("failed", [
          ["a", "completed"],
          ["b", "pending"],
        ]),
      ),
    );
    const r1 = doneWhen(["x"], ["failed"]);
    const r2 = doneWhen(["x"], ["failed"]);
    expect(doneWhenSignature(r1)).toBe(doneWhenSignature(r2));
  });

  it("the repair node carries the unmet conditions and the continuation instruction", () => {
    const plan = planOf("completed", [["a", "completed"]]);
    const node = repairNodeForUnmetDoneWhen(["tests pass"], 1, plan);
    expect(node.status).toBe("ready");
    expect(node.objective).toContain("Do not repeat completed work");
    expect(node.objective).toContain("tests pass");
    expect(node.successCriteria).toEqual(["Condition met: tests pass"]);
    expect(incompleteNodes({ ...plan, nodes: [...plan.nodes, node] })).toHaveLength(1);
    expect(unmetDoneWhenLabels(doneWhen(["a", "b"], ["passed", "failed"]))).toEqual(["b"]);
  });
});
