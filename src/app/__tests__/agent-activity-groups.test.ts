import { describe, expect, it } from "vitest";
import { groupSummary, groupToolCalls, toolGroupKind } from "../agent-activity-groups";
import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";

function call(id: string, toolName: string, args: Record<string, unknown> = {}): ToolCallRecord {
  return { id, toolName, arguments: args };
}

function result(id: string): ToolResultRecord {
  return { toolCallId: id, toolName: "x", success: true, output: "ok" };
}

describe("agent activity grouping", () => {
  it("classifies tool names into categories", () => {
    expect(toolGroupKind("read_file")).toBe("inspect");
    expect(toolGroupKind("search_files")).toBe("inspect");
    expect(toolGroupKind("write_file")).toBe("change");
    expect(toolGroupKind("apply_patch")).toBe("change");
    expect(toolGroupKind("run_command")).toBe("command");
    expect(toolGroupKind("browser_click")).toBe("browser");
    expect(toolGroupKind("mcp__x__y")).toBe("other");
  });

  it("merges only consecutive calls of the same kind", () => {
    const groups = groupToolCalls(
      [
        call("1", "read_file"),
        call("2", "read_file"),
        call("3", "write_file"),
        call("4", "read_file"),
      ],
      [result("1"), result("2"), result("3"), result("4")],
    );
    expect(groups.map((group) => group.kind)).toEqual(["inspect", "change", "inspect"]);
    expect(groups[0]?.calls).toHaveLength(2);
  });

  it("summarizes groups with file counts", () => {
    const groups = groupToolCalls(
      [
        call("1", "read_file", { path: "/a.ts" }),
        call("2", "read_file", { path: "/b.ts" }),
        call("3", "write_file", { path: "/c.ts" }),
      ],
      [result("1"), result("2"), result("3")],
    );
    const inspect = groupSummary(groups[0]!);
    expect(inspect.values).toMatchObject({ count: 2, files: 2, reads: 2 });
    const change = groupSummary(groups[1]!);
    expect(change.values).toMatchObject({ count: 1, files: 1 });
  });

  it("attaches results by call id", () => {
    const groups = groupToolCalls([call("1", "read_file")], []);
    expect(groups[0]?.calls[0]?.result).toBeUndefined();
    const withResults = groupToolCalls([call("1", "read_file")], [result("1")]);
    expect(withResults[0]?.calls[0]?.result?.toolCallId).toBe("1");
  });
});
