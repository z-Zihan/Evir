import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvirRuntime } from "../../../runtime/types";
import { useOrchestrationStore } from "../orchestration-store";
import { approveCurrentPlan } from "../orchestration-session";

vi.mock("../../../runtime/get-runtime", () => ({ getRuntime: () => ({}) }));

const runtime = {
  target: "desktop",
  capabilities: new Set(["chat"]),
  has: (capability: string) => capability === "chat",
} satisfies EvirRuntime;

function seedPlan(phase: "confirmation" | "paused" | "execution", approvalStatus: string) {
  useOrchestrationStore.setState({
    current: {
      runId: "run-1",
      conversationId: "conversation-1",
      phase,
      brief: { id: "brief", objective: "Do the thing", createdAt: 1 },
      plan: {
        id: "plan-1",
        revision: 1,
        nodes: [
          {
            id: "inspect",
            kind: "task",
            title: "Inspect",
            objective: "Look",
            dependencies: [],
            requiredCapabilities: [],
            resourceScopes: [],
            expectedArtifacts: [],
            successCriteria: [],
            status: "completed",
          },
          {
            id: "approve",
            kind: "approval",
            title: "Approve",
            objective: "Confirm",
            dependencies: [],
            requiredCapabilities: [],
            resourceScopes: [],
            expectedArtifacts: [],
            successCriteria: [],
            status: approvalStatus,
          },
        ],
        edges: [],
        status: "paused",
        requiresConfirmation: true,
        createdAt: 1,
        updatedAt: 1,
      },
      assignments: [],
      events: [],
    },
    preparing: null,
  } as never);
}

describe("approveCurrentPlan paused-run unlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends plan.confirmed when a paused run is blocked on the approval node", async () => {
    seedPlan("paused", "blocked");
    const approved = await approveCurrentPlan(runtime, true);
    expect(approved).toBe(true);
    const current = useOrchestrationStore.getState().current;
    expect(current?.events.some(({ type }) => type === "plan.confirmed")).toBe(true);
    expect(current?.phase).toBe("execution");
  });

  it("still rejects confirmation while the run is already executing", async () => {
    seedPlan("execution", "completed");
    const approved = await approveCurrentPlan(runtime, true);
    expect(approved).toBe(false);
    expect(useOrchestrationStore.getState().current?.events).toHaveLength(0);
  });
});
