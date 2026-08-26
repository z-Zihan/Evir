import { describe, expect, it } from "vitest";
import { explainToolCallWithoutAccess } from "../stream-response";
import type { StreamResult } from "../chat-stream";
import "../../../i18n/config";

function stream(partial: Partial<StreamResult>): StreamResult {
  return { content: "", status: "complete", ...partial };
}

describe("explainToolCallWithoutAccess", () => {
  it("replaces an empty reply with an explanation when the model emitted tool calls", () => {
    const result = explainToolCallWithoutAccess(
      stream({
        toolCalls: [
          { id: "call-1", toolName: "read_file", arguments: "{}" },
          { id: "call-2", toolName: "write_file", arguments: "{}" },
          { id: "call-3", toolName: "read_file", arguments: "{}" },
        ],
      }),
    );
    expect(result.content).toContain("read_file");
    expect(result.content).toContain("write_file");
    // 去重后的工具名只出现一次 read_file
    expect(result.content.match(/read_file/g)).toHaveLength(1);
    expect(result.content).toContain("Agent");
    expect(result.toolCalls).toHaveLength(3);
  });

  it("keeps a non-empty reply untouched", () => {
    const original = stream({
      content: "正常回复内容",
      toolCalls: [{ id: "call-1", toolName: "read_file", arguments: "{}" }],
    });
    expect(explainToolCallWithoutAccess(original)).toBe(original);
  });

  it("keeps a plain empty stream without tool calls untouched", () => {
    const original = stream({ content: "   " });
    expect(explainToolCallWithoutAccess(original)).toBe(original);
  });
});
