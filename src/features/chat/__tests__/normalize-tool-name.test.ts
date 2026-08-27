import { describe, expect, it } from "vitest";
import { normalizeToolCallName } from "../agent-loop";

describe("normalizeToolCallName", () => {
  const allowed = new Set(["run_command", "write_file", "read_file"]);

  it("keeps a well-formed name unchanged", () => {
    expect(normalizeToolCallName("write_file", allowed)).toBe("write_file");
  });

  it("recovers a name with serialized argument junk appended", () => {
    const malformed = "run_commandprogram</arg_key><arg_value>ls</arg_value>";
    expect(normalizeToolCallName(malformed, allowed)).toBe("run_command");
  });

  it("returns an unknown name unchanged when no known tool is a prefix", () => {
    expect(normalizeToolCallName("search_web", allowed)).toBe("search_web");
  });

  it("prefers the longest matching tool id", () => {
    const tools = new Set(["run", "run_command"]);
    expect(normalizeToolCallName("run_commandx", tools)).toBe("run_command");
  });
});
