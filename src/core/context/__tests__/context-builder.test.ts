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
    expect(result.systemPrompt).not.toContain("<knowledge>");
    expect(result.contextTokens).toBeGreaterThan(0);
  });

  it("wraps knowledge excerpts with provenance in a <knowledge> section", () => {
    const result = new ContextBuilderImpl().buildSystemPrompt({
      knowledge: "- [architecture.md | /ws/architecture.md] layered design",
      memory: "- [note] prefers concise answers",
    });
    expect(result.systemPrompt).toContain(
      "<knowledge>\n- [architecture.md | /ws/architecture.md] layered design\n</knowledge>",
    );
    // Memory stays its own section — knowledge never merges into it (§62).
    expect(result.systemPrompt).toContain("<memory>");
    expect(result.systemPrompt.indexOf("<memory>")).toBeLessThan(
      result.systemPrompt.indexOf("<knowledge>"),
    );
  });
});
