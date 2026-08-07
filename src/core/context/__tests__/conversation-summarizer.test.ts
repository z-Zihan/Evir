// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../features/chat/chat-stream", () => ({
  streamAssistant: vi.fn(() =>
    Promise.resolve({
      content: "Summary of conversation: user asked to read files.",
      status: "complete",
      toolCalls: [],
    }),
  ),
}));

vi.mock("../../../core/storage/db", () => ({
  db: {
    settings: {
      get: vi.fn(() => Promise.resolve(null)),
      put: vi.fn(() => Promise.resolve()),
    },
  },
}));

import {
  summarizeConversation,
  buildCompressedHistory,
  splitForSummarization,
  estimateSavings,
} from "../conversation-summarizer";
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

describe("splitForSummarization", () => {
  it("splits messages into summarize and keep", () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg({ id: `m${i}`, content: `Message ${i} `.repeat(50) }),
    );
    const { toSummarize, toKeep } = splitForSummarization(msgs, 200);
    expect(toSummarize.length).toBeGreaterThan(0);
    expect(toKeep.length).toBeGreaterThan(0);
    expect(toSummarize.length + toKeep.length).toBe(10);
  });

  it("keeps all messages if budget is large enough", () => {
    const msgs = [makeMsg(), makeMsg()];
    const { toSummarize, toKeep } = splitForSummarization(msgs, 999999);
    expect(toSummarize).toHaveLength(0);
    expect(toKeep).toHaveLength(2);
  });

  it("summarizes all if budget is 0", () => {
    const msgs = [makeMsg(), makeMsg(), makeMsg()];
    const { toSummarize, toKeep } = splitForSummarization(msgs, 0);
    expect(toSummarize.length).toBe(2);
    expect(toKeep.length).toBe(1);
  });
});

describe("buildCompressedHistory", () => {
  it("creates summary message + recent messages", () => {
    const recent = [makeMsg({ id: "r1" }), makeMsg({ id: "r2" })];
    const result = buildCompressedHistory("Summary text", recent, "c1");
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("system");
    expect(result[0]!.content).toContain("Summary text");
    expect(result[1]!.id).toBe("r1");
    expect(result[2]!.id).toBe("r2");
  });

  it("versions the summary and links the preserved source range", () => {
    const source = [makeMsg({ id: "s1", createdAt: 10 }), makeMsg({ id: "s2", createdAt: 20 })];
    const result = buildCompressedHistory(
      "Summary text",
      [makeMsg({ id: "recent" })],
      "c1",
      source,
    );
    expect(result[0]?.summaryMetadata).toMatchObject({
      version: 1,
      sourceMessageIds: ["s1", "s2"],
      sourceStartedAt: 10,
      sourceEndedAt: 20,
    });
    expect(result[0]?.summaryMetadata?.archiveId).toContain(result[0]?.id ?? "missing");
  });
});

describe("estimateSavings", () => {
  it("returns positive savings when summary is shorter", () => {
    const msgs = [makeMsg({ content: "x".repeat(1000) })];
    const savings = estimateSavings(msgs, 50);
    expect(savings).toBeGreaterThan(0);
  });

  it("returns 0 when summary is longer", () => {
    const msgs = [makeMsg({ content: "hi" })];
    const savings = estimateSavings(msgs, 5000);
    expect(savings).toBe(0);
  });
});

describe("summarizeConversation", () => {
  it("returns empty string for empty messages", async () => {
    const provider = {
      id: "p1",
      name: "Test",
      protocolId: "openai-chat-completions" as const,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelId: "gpt-4",
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const result = await summarizeConversation(provider, []);
    expect(result).toBe("");
  });
});
