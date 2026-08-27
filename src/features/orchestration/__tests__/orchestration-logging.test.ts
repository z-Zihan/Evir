import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { logger } from "../../../core/logging/logger";
import { db } from "../../../core/storage/db";
import { IndexedDBAdapter } from "../../../core/storage/indexed-db-adapter";
import type { EvirRuntime } from "../../../runtime/types";
import { prepareTask, submitClarifications } from "../orchestration-session";
import { useOrchestrationStore } from "../orchestration-store";

const runtime = {
  target: "desktop",
  capabilities: new Set(["chat", "filesystem"]),
  has: (capability: string) => capability === "chat" || capability === "filesystem",
  structuredStorage: new IndexedDBAdapter(),
  getWorkspaceRoot: () => null,
} as EvirRuntime;

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  logger.clear();
  useOrchestrationStore.getState().setCurrent(null);
});

describe("orchestration diagnostic events", () => {
  it("records intake and clarification without logging the objective", async () => {
    const objective = "修改一下 PRIVATE_OBJECTIVE_MARKER";
    await expect(
      prepareTask({
        objective,
        conversationId: "conversation-log",
        runtime,
        privateSession: true,
      }),
    ).resolves.toBe("clarification");

    expect(logger.getEntries().map(({ event }) => event)).toEqual(
      expect.arrayContaining([
        "orchestration.intake-started",
        "orchestration.intake-completed",
        "orchestration.clarification-requested",
      ]),
    );
    expect(logger.exportLogs()).not.toContain("PRIVATE_OBJECTIVE_MARKER");
    const requested = logger.getEntries().at(-1);
    expect(requested?.conversationId).toBe("conversation-log");
    expect(typeof requested?.runId).toBe("string");
    expect(typeof requested?.data?.questionCount).toBe("number");
    expect(typeof requested?.data?.durationMs).toBe("number");
  });

  it("records clarification answers and exhaustion", async () => {
    await prepareTask({
      objective: "修改一下",
      conversationId: "conversation-exhausted",
      runtime,
      privateSession: true,
    });
    await expect(submitClarifications({}, runtime, true)).resolves.toBe("clarification");
    await expect(submitClarifications({}, runtime, true)).resolves.toBe("blocked");

    expect(logger.getEntries().map(({ event }) => event)).toEqual(
      expect.arrayContaining([
        "orchestration.clarification-answered",
        "orchestration.clarification-exhausted",
      ]),
    );
  });
});
