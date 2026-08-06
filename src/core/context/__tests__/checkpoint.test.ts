// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../storage/db", () => ({
  db: {
    settings: {
      get: vi.fn(() => Promise.resolve(null)),
      put: vi.fn(() => Promise.resolve()),
    },
  },
}));

import { createCheckpoint, loadCheckpoint, buildHandoffMessage } from "../checkpoint";
import type { MessageRecord } from "../../storage/db";

function makeMsg(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: `m-${Math.random()}`,
    conversationId: "c1",
    role: "user",
    content: "Hello",
    status: "complete",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("createCheckpoint", () => {
  it("creates a checkpoint with conversation info", async () => {
    const msgs = [
      makeMsg({ role: "user", content: "Fix the bug in auth.ts" }),
      makeMsg({ role: "assistant", content: "I found and fixed the bug ✅" }),
    ];
    const cp = await createCheckpoint("c1", msgs, "Fix the bug in auth.ts");
    expect(cp.conversationId).toBe("c1");
    expect(cp.messageCount).toBe(2);
    expect(cp.objective).toBe("Fix the bug in auth.ts");
    expect(cp.id).toBeTruthy();
  });

  it("extracts completed steps from assistant messages", async () => {
    const msgs = [makeMsg({ role: "assistant", content: "Task completed ✅" })];
    const cp = await createCheckpoint("c1", msgs, "test");
    expect(cp.completedSteps.length).toBeGreaterThan(0);
  });

  it("extracts unresolved errors", async () => {
    const msgs = [makeMsg({ role: "assistant", status: "error", errorMessage: "API failed" })];
    const cp = await createCheckpoint("c1", msgs, "test");
    expect(cp.unresolvedErrors).toContain("API failed");
  });
});

describe("loadCheckpoint", () => {
  it("returns null when no checkpoint exists", async () => {
    const result = await loadCheckpoint("nonexistent");
    expect(result).toBeNull();
  });
});

describe("buildHandoffMessage", () => {
  it("builds a system message with checkpoint info", () => {
    const cp = {
      id: "cp-1",
      conversationId: "c1",
      createdAt: Date.now(),
      messageCount: 10,
      tokenEstimate: 5000,
      summary: "Test summary",
      objective: "Fix bugs",
      completedSteps: ["Read file", "Apply patch"],
      pendingSteps: ["Run tests"],
      unresolvedErrors: ["Test failed"],
    };
    const msg = buildHandoffMessage(cp, "gpt-4o");
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("gpt-4o");
    expect(msg.content).toContain("Fix bugs");
    expect(msg.content).toContain("Read file");
    expect(msg.content).toContain("Run tests");
    expect(msg.content).toContain("Test failed");
  });
});
