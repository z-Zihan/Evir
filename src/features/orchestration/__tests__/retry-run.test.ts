import { beforeEach, describe, expect, it } from "vitest";
import type { PlanGraph, PlanNode, TaskBrief } from "../../../core/orchestration/types";
import type { EvirRuntime } from "../../../runtime/types";
import { retryCurrentRun } from "../orchestration-session";
import { useOrchestrationStore } from "../orchestration-store";

const brief: TaskBrief = {
  id: "brief-1",
  runId: "run-1",
  conversationId: "conversation-1",
  goalKind: "change",
  objective: "Read then write",
  constraints: [],
  deliverables: ["output.txt"],
  acceptanceCriteria: ["written"],
  requiredCapabilities: ["filesystem"],
  assumptions: [],
  unknowns: [],
  risk: "medium",
  clarificationRound: 0,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

function node(id: string, dependencies: string[], status: PlanNode["status"]): PlanNode {
  return {
    id,
    kind: "task",
    title: id,
    objective: id,
    dependencies,
    requiredCapabilities: ["filesystem"],
    resourceScopes: [{ kind: "workspace", value: ".", access: "read" }],
    expectedArtifacts: [],
    successCriteria: [],
    status,
  };
}

const runtime = {
  target: "desktop",
  capabilities: new Set(["filesystem"]),
  has: (capability: string) => capability === "filesystem",
} as unknown as EvirRuntime;

function seedStore(plan: PlanGraph, phase: "finished" | "execution"): void {
  useOrchestrationStore.getState().setCurrent({
    runId: brief.runId,
    conversationId: brief.conversationId,
    phase,
    brief,
    plan,
    assignments: [],
    events: [],
  });
}

describe("retryCurrentRun", () => {
  beforeEach(() => {
    useOrchestrationStore.getState().setCurrent(null);
  });

  it("keeps completed nodes and resets failed or pending ones to runnable states", async () => {
    const plan: PlanGraph = {
      id: "plan-1",
      runId: "run-1",
      conversationId: "conversation-1",
      briefVersion: 1,
      revision: 1,
      nodes: [
        node("inspect", [], "completed"),
        node("execute", ["inspect"], "failed"),
        node("verify", ["execute"], "pending"),
      ],
      edges: [
        { from: "inspect", to: "execute", when: "success" },
        { from: "execute", to: "verify", when: "success" },
      ],
      status: "partial",
      requiresConfirmation: false,
      createdAt: 1,
      updatedAt: 1,
    };
    seedStore(plan, "finished");

    const ok = await retryCurrentRun(runtime, true);
    expect(ok).toBe(true);

    const current = useOrchestrationStore.getState().current;
    expect(current?.phase).toBe("execution");
    expect(current?.plan?.status).toBe("ready");
    const statuses = current?.plan?.nodes.map(({ id, status }) => `${id}:${status}`);
    expect(statuses).toEqual(["inspect:completed", "execute:ready", "verify:pending"]);
  });

  it("refuses to retry a completed run or a run that is not finished", async () => {
    seedStore(
      {
        id: "plan-2",
        runId: "run-1",
        conversationId: "conversation-1",
        briefVersion: 1,
        revision: 1,
        nodes: [node("inspect", [], "completed")],
        edges: [],
        status: "completed",
        requiresConfirmation: false,
        createdAt: 1,
        updatedAt: 1,
      },
      "finished",
    );
    expect(await retryCurrentRun(runtime, true)).toBe(false);

    seedStore(
      {
        id: "plan-3",
        runId: "run-1",
        conversationId: "conversation-1",
        briefVersion: 1,
        revision: 1,
        nodes: [node("inspect", [], "running")],
        edges: [],
        status: "running",
        requiresConfirmation: false,
        createdAt: 1,
        updatedAt: 1,
      },
      "execution",
    );
    expect(await retryCurrentRun(runtime, true)).toBe(false);
  });
});
