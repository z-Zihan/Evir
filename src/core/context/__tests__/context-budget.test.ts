import { describe, expect, it } from "vitest";
import { createContextBudgetManager } from "../context-budget-manager";
import { getCompressionStage } from "../context-budget-manager";
import { estimateTokens, estimateMessagesTokens } from "../token-estimate";
import { compactToolOutputs } from "../compact-tool-outputs";
import type { MessageRecord } from "../../storage/db";

describe("estimateTokens", () => {
  it("returns 1 for empty string", () => {
    expect(estimateTokens("")).toBe(1);
  });
  it("returns 1 for short string", () => {
    expect(estimateTokens("hi")).toBe(1);
  });
  it("estimates long text reasonably", () => {
    const text = "a".repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums token estimates across messages", () => {
    const messages = [{ content: "hello world" }, { content: { nested: "data" } }];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
  it("skips null/undefined content", () => {
    const messages = [{ content: null }, { content: undefined }];
    expect(estimateMessagesTokens(messages)).toBe(0);
  });
});

describe("ContextBudgetManager", () => {
  const manager = createContextBudgetManager();

  it("computes snapshot with correct reserved tokens", () => {
    const snap = manager.snapshot("model-1", 100_000, 30_000);
    expect(snap.maxContextTokens).toBe(100_000);
    expect(snap.safetyMarginTokens).toBe(10_000);
    expect(snap.reservedOutputTokens).toBe(20_000);
    expect(snap.reservedToolTokens).toBe(10_000);
    // available = 100000 - 10000 - 20000 - 10000 = 60000
    // utilization = 30000 / 60000 = 0.5
    expect(snap.utilizationRatio).toBeCloseTo(0.5, 1);
    expect(snap.compressionStage).toBe("none");
  });

  it("shouldCompact returns false below 0.6", () => {
    const snap = manager.snapshot("model-1", 100_000, 30_000);
    expect(manager.shouldCompact(snap)).toBe(false);
  });

  it("shouldCompact returns true above 0.6", () => {
    const snap = manager.snapshot("model-1", 100_000, 40_000);
    expect(manager.shouldCompact(snap)).toBe(true);
  });
});

describe("getCompressionStage", () => {
  it("returns none below 0.6", () => {
    expect(getCompressionStage(0.5)).toBe("none");
    expect(getCompressionStage(0.59)).toBe("none");
  });
  it("returns tool-output-compaction between 0.6 and 0.75", () => {
    expect(getCompressionStage(0.61)).toBe("tool-output-compaction");
    expect(getCompressionStage(0.65)).toBe("tool-output-compaction");
    expect(getCompressionStage(0.74)).toBe("tool-output-compaction");
  });
  it("returns conversation-summary between 0.75 and 0.9", () => {
    expect(getCompressionStage(0.76)).toBe("conversation-summary");
    expect(getCompressionStage(0.8)).toBe("conversation-summary");
    expect(getCompressionStage(0.89)).toBe("conversation-summary");
  });
  it("returns checkpoint-compaction above 0.9", () => {
    expect(getCompressionStage(0.91)).toBe("checkpoint-compaction");
    expect(getCompressionStage(0.95)).toBe("checkpoint-compaction");
    expect(getCompressionStage(1.0)).toBe("checkpoint-compaction");
  });
});

describe("compactToolOutputs", () => {
  function makeMessage(toolResults: { toolCallId: string; output: string }[]): MessageRecord {
    return {
      id: "msg-1",
      conversationId: "conv-1",
      role: "assistant",
      content: "text",
      status: "complete",
      createdAt: 1,
      toolResults: toolResults.map((r) => ({
        toolCallId: r.toolCallId,
        toolName: "test_tool",
        success: true,
        output: r.output,
      })),
    };
  }

  it("preserves messages without tool results", async () => {
    const messages: MessageRecord[] = [
      {
        id: "1",
        conversationId: "c",
        role: "user",
        content: "hi",
        status: "complete",
        createdAt: 1,
      },
    ];
    const result = await compactToolOutputs(messages, 1000);
    expect(result).toEqual(messages);
  });

  it("preserves short tool outputs", async () => {
    const msg = makeMessage([{ toolCallId: "call-1", output: "short" }]);
    const result = await compactToolOutputs([msg], 1000);
    expect(result[0]?.toolResults?.[0]?.output).toBe("short");
  });

  it("truncates long tool outputs when total exceeds limit", async () => {
    const longOutput = "x".repeat(500);
    const msg = makeMessage([{ toolCallId: "call-1", output: longOutput }]);
    const result = await compactToolOutputs([msg], 100);
    expect(result[0]?.toolResults?.[0]?.output.length).toBeLessThan(longOutput.length);
    expect(result[0]?.toolResults?.[0]?.output).toContain("[truncated]");
  });

  it("archives the full output and names the artifact in the truncation marker (§20)", async () => {
    const longOutput = "y".repeat(500);
    const msg = makeMessage([{ toolCallId: "call-arch", output: longOutput }]);
    const archived: { toolCallId: string; output: string }[] = [];
    const result = await compactToolOutputs([msg], 100, {
      archiveFullOutput: ({ toolCallId, output }) => {
        archived.push({ toolCallId, output });
        return Promise.resolve("artifact-1");
      },
    });
    expect(archived).toEqual([{ toolCallId: "call-arch", output: longOutput }]);
    expect(result[0]?.toolResults?.[0]?.output).toContain("[full output archived: artifact-1]");
    // The store's original message is never mutated.
    expect(msg.toolResults?.[0]?.output).toBe(longOutput);
  });

  it("keeps plain truncation when archival fails", async () => {
    const longOutput = "z".repeat(500);
    const msg = makeMessage([{ toolCallId: "call-fail", output: longOutput }]);
    const result = await compactToolOutputs([msg], 100, {
      archiveFullOutput: () => Promise.reject(new Error("storage down")),
    });
    expect(result[0]?.toolResults?.[0]?.output).toContain("[truncated]");
    expect(result[0]?.toolResults?.[0]?.output).not.toContain("archived");
  });

  it("preserves tool call IDs and success status", async () => {
    const longOutput = "x".repeat(500);
    const msg = makeMessage([{ toolCallId: "call-1", output: longOutput }]);
    const result = await compactToolOutputs([msg], 100);
    expect(result[0]?.toolResults?.[0]?.toolCallId).toBe("call-1");
    expect(result[0]?.toolResults?.[0]?.success).toBe(true);
  });
});
