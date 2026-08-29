// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { TaskBrief } from "../../../core/orchestration/types";
import type { EvirRuntime } from "../../../runtime/types";
import { submitClarifications } from "../orchestration-session";
import { useOrchestrationStore } from "../orchestration-store";

const brief: TaskBrief = {
  id: "brief-1",
  runId: "run-1",
  conversationId: "conversation-1",
  goalKind: "change",
  objective: "Do the thing",
  constraints: [],
  deliverables: [],
  acceptanceCriteria: [],
  requiredCapabilities: [],
  assumptions: [],
  unknowns: [
    { id: "u1", question: "Which file?", impact: "scope", suggestedAnswers: ["a.ts", "b.ts"] },
  ],
  risk: "low",
  clarificationRound: 0,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

const runtime = {
  target: "desktop",
  capabilities: new Set(["chat"]),
  has: (capability: string) => capability === "chat",
} satisfies EvirRuntime;

function seedClarification(): void {
  useOrchestrationStore.getState().setCurrent({
    runId: brief.runId,
    conversationId: brief.conversationId,
    phase: "clarification",
    brief,
    assignments: [],
    events: [],
  });
}

describe("rapid re-click guard on submission entry points", () => {
  beforeEach(() => {
    useOrchestrationStore.getState().setCurrent(null);
  });

  it("a second submit while the first is still planning is rejected, not queued", async () => {
    seedClarification();
    let releasePlanning: ((value: void) => void) | undefined;
    const planningHeld = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    // The planner port blocks until we let it go, mimicking the slow
    // provider call during which the user clicks "continue" again.
    const planner = {
      generate: async () => {
        await planningHeld;
        throw new Error("planner not needed for this assertion");
      },
    };

    const first = submitClarifications({ u1: "a.ts" }, runtime, true, planner);
    // The synchronous part of submitClarifications must have already moved
    // the phase off "clarification" — this is exactly the state a rapid
    // second click observes.
    expect(useOrchestrationStore.getState().current?.phase).toBe("planning");
    const second = await submitClarifications({ u1: "a.ts" }, runtime, true, planner);
    expect(second).toBe("not-applicable");

    releasePlanning?.();
    const firstResult = await first;
    // The first submission ran to its failure path and restored the form.
    expect(firstResult).toBe("clarification");
    expect(useOrchestrationStore.getState().current?.phase).toBe("clarification");
  });

  it("restores the clarification phase when plan generation throws", async () => {
    seedClarification();
    const planner = {
      generate: () => Promise.reject(new Error("provider exploded")),
    };
    const result = await submitClarifications({ u1: "a.ts" }, runtime, true, planner);
    expect(result).toBe("clarification");
    expect(useOrchestrationStore.getState().current?.phase).toBe("clarification");
  });
});
