import { describe, expect, it } from "vitest";

import { GraphScheduler, resourcesConflict } from "../scheduler";
import type { PlanGraph, PlanNode } from "../types";

function writeNode(id: string, isolation?: "worktree"): PlanNode {
  return {
    id,
    kind: "subagent",
    title: id,
    objective: id,
    dependencies: [],
    requiredCapabilities: [],
    resourceScopes: [{ kind: "workspace", value: "/repo", access: "write" }],
    expectedArtifacts: [],
    successCriteria: [],
    status: "ready",
    ...(isolation ? { isolation } : {}),
  };
}

describe("worktree isolation scheduling", () => {
  it("conflicting write nodes conflict without isolation and co-exist with worktrees", () => {
    expect(resourcesConflict(writeNode("a"), writeNode("b"))).toBe(true);
    expect(resourcesConflict(writeNode("a", "worktree"), writeNode("b", "worktree"))).toBe(false);
    // Isolation never lets a write bypass a non-isolated conflicting node.
    expect(resourcesConflict(writeNode("a", "worktree"), writeNode("b"))).toBe(true);
  });

  it("runs isolated write nodes in parallel and merges back sequentially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const finished: string[] = [];
    const executor = async (node: PlanNode) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      finished.push(node.id);
      return { status: "completed" as const, summary: `${node.id} done` };
    };
    const plan: PlanGraph = {
      id: "p",
      runId: "r",
      conversationId: "c",
      briefVersion: 1,
      revision: 1,
      nodes: [writeNode("w1", "worktree"), writeNode("w2", "worktree")],
      edges: [],
      status: "ready",
      requiresConfirmation: false,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = await new GraphScheduler(executor, 2).run(plan);

    expect(result.status).toBe("completed");
    expect(maxInFlight).toBe(2);
    expect(finished.sort()).toEqual(["w1", "w2"]);
  });

  it("still serializes non-isolated conflicting writes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const executor = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { status: "completed" as const, summary: "ok" };
    };
    const plan: PlanGraph = {
      id: "p",
      runId: "r",
      conversationId: "c",
      briefVersion: 1,
      revision: 1,
      nodes: [writeNode("w1"), writeNode("w2")],
      edges: [],
      status: "ready",
      requiresConfirmation: false,
      createdAt: 1,
      updatedAt: 1,
    };

    await new GraphScheduler(executor, 2).run(plan);

    expect(maxInFlight).toBe(1);
  });
});
