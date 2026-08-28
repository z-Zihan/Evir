import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../../core/storage/db";
import { IndexedDBAdapter } from "../../../core/storage/indexed-db-adapter";
import type { EvirRuntime } from "../../../runtime/types";
import { cancelTaskPreparation, prepareTask } from "../orchestration-session";
import { useOrchestrationStore } from "../orchestration-store";

const runtime = {
  target: "desktop",
  capabilities: new Set(["chat", "filesystem"]),
  has: (capability: string) => capability === "chat" || capability === "filesystem",
  structuredStorage: new IndexedDBAdapter(),
  getWorkspaceRoot: () => null,
} as EvirRuntime;

// Deterministic brief with no blocking unknowns, so preparation reaches the
// planning stage instead of returning "clarification".
const analyzer = {
  analyze: () =>
    Promise.resolve({
      goalKind: "change",
      objective: "change something concrete",
      constraints: [],
      deliverables: [],
      acceptanceCriteria: [],
      requiredCapabilities: ["filesystem"],
      assumptions: [],
      unknowns: [],
      risk: "low",
    }),
};

function deferredPlanner(): {
  planner: { generate: () => Promise<never> };
  cancelDuringPlanning: () => void;
} {
  const conversationId = "conversation-cancel";
  return {
    planner: {
      generate: () =>
        new Promise((_resolve, reject) => {
          // The user pressed Stop while the planner request was in flight:
          // the abort surfaces as a rejected stream.
          setTimeout(() => {
            cancelTaskPreparation(conversationId);
            reject(new Error("Planner stream aborted"));
          }, 0);
        }),
    },
    cancelDuringPlanning: () => cancelTaskPreparation(conversationId),
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  useOrchestrationStore.getState().setCurrent(null);
});

describe("cancelling during planning", () => {
  it("returns cancelled instead of proceeding with the fallback plan", async () => {
    const { planner } = deferredPlanner();
    const result = await prepareTask({
      objective: "change something concrete",
      conversationId: "conversation-cancel",
      runtime,
      privateSession: true,
      analyzer,
      planner,
    });
    expect(result).toBe("cancelled");
    expect(useOrchestrationStore.getState().current?.phase).toBe("finished");
  });
});
