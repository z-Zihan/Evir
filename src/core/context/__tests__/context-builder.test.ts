import { describe, expect, it } from "vitest";
import { ContextBuilderImpl } from "../context-builder";

describe("ContextBuilderImpl", () => {
  it("builds ordered structured context without empty sections", () => {
    const result = new ContextBuilderImpl().buildSystemPrompt({
      modeRules: "Agent safety rules",
      runCapsule: "Objective: fix the bug",
      fileReferences: [
        {
          path: "/repo/src/app.ts",
          contentHash: "abc",
          lastReadAt: 0,
          summary: "Read 100 bytes",
          stale: true,
        },
      ],
      personalization: "User prefers concise answers",
    });

    expect(result.systemPrompt.indexOf("Agent safety rules")).toBeLessThan(
      result.systemPrompt.indexOf("<personalization>"),
    );
    expect(result.systemPrompt).toContain("<run_state>");
    expect(result.systemPrompt).toContain("stale=true");
    expect(result.systemPrompt).not.toContain("<memory>");
    expect(result.contextTokens).toBeGreaterThan(0);
  });
});
