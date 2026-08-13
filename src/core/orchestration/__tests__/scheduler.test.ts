import { describe, expect, it, vi } from "vitest";
import { GraphScheduler, resourcesConflict } from "../scheduler";
import type { PlanGraph, PlanNode } from "../types";

function task(id: string, value: string, access: "read" | "write"): PlanNode {
  return {
    id,
    kind: "task",
    title: id,
    objective: id,
    dependencies: [],
    requiredCapabilities: [],
    resourceScopes: [{ kind: "path", value, access }],
    expectedArtifacts: [],
    successCriteria: [],
    status: "ready",
  };
}

function plan(nodes: PlanNode[]): PlanGraph {
  return {
    id: "plan-1",
    runId: "run-1",
    conversationId: "conversation-1",
    briefVersion: 1,
    revision: 1,
    nodes,
    edges: [],
    status: "ready",
    requiresConfirmation: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("GraphScheduler", () => {
  it("detects overlapping writes but allows parallel reads", () => {
    expect(resourcesConflict(task("a", "/a", "read"), task("b", "/a", "read"))).toBe(false);
    expect(resourcesConflict(task("a", "/a", "write"), task("b", "/a/file", "read"))).toBe(true);
    expect(
      resourcesConflict(
        { ...task("a", "/a", "read"), resourceScopes: [] },
        task("b", "/b", "write"),
      ),
    ).toBe(true);
    expect(
      resourcesConflict(
        { ...task("a", "/a", "read"), resourceScopes: [] },
        { ...task("b", "/b", "read"), resourceScopes: [] },
      ),
    ).toBe(true);
  });

  it("runs independent nodes in parallel", async () => {
    let active = 0;
    let maximum = 0;
    const scheduler = new GraphScheduler(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { status: "completed", summary: "done" };
    });
    const result = await scheduler.run(plan([task("a", "/a", "read"), task("b", "/b", "read")]));
    expect(maximum).toBe(2);
    expect(result.status).toBe("completed");
  });

  it("serializes conflicting writes", async () => {
    const started: string[] = [];
    const onPlanChanged = vi.fn();
    const scheduler = new GraphScheduler(
      (node) => {
        started.push(node.id);
        return Promise.resolve({ status: "completed" as const, summary: "done" });
      },
      2,
      { onPlanChanged },
    );
    const result = await scheduler.run(
      plan([task("a", "/a", "write"), task("b", "/a/file", "write")]),
    );
    expect(started).toEqual(["a", "b"]);
    expect(result.status).toBe("completed");
    expect(onPlanChanged).toHaveBeenCalled();
  });

  it("does not run a dependent node before its dependency", async () => {
    const sequence: string[] = [];
    const first = task("first", "/a", "read");
    const second = {
      ...task("second", "/b", "read"),
      status: "pending" as const,
      dependencies: ["first"],
    };
    const graph = plan([first, second]);
    graph.edges = [{ from: "first", to: "second", when: "success" }];
    await new GraphScheduler((node) => {
      sequence.push(node.id);
      return Promise.resolve({ status: "completed" as const, summary: "done" });
    }).run(graph);
    expect(sequence).toEqual(["first", "second"]);
  });

  it("marks non-selected conditional branches skipped and continues always edges", async () => {
    const sequence: string[] = [];
    const skipped: string[] = [];
    const first = task("first", "/a", "read");
    const failure = {
      ...task("failure", "/b", "read"),
      status: "pending" as const,
      dependencies: ["first"],
    };
    const join = {
      ...task("join", "/c", "read"),
      status: "pending" as const,
      dependencies: ["failure"],
    };
    const graph = plan([first, failure, join]);
    graph.edges = [
      { from: "first", to: "failure", when: "failure" },
      { from: "failure", to: "join", when: "always" },
    ];
    const result = await new GraphScheduler(
      (node) => {
        sequence.push(node.id);
        return Promise.resolve({ status: "completed" as const, summary: "done" });
      },
      2,
      { onNodeSkipped: (node) => void skipped.push(node.id) },
    ).run(graph);
    expect(sequence).toEqual(["first", "join"]);
    expect(skipped).toEqual(["failure"]);
    expect(result.status).toBe("completed");
  });
});
