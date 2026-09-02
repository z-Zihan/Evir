import { describe, expect, it } from "vitest";

import type { ToolResultRecord } from "../../../core/storage/db";
import { TOOL_DENIED, TOOL_PERMISSION_REQUIRED } from "../../../core/tools/tool-executor";
import { deriveToolStatus, isTerminalToolStatus } from "../tool-view-model";

const call = { id: "call-1" };

function result(overrides: Partial<ToolResultRecord>): ToolResultRecord {
  return {
    toolCallId: "call-1",
    toolName: "list_directory",
    success: true,
    output: "",
    startedAt: 0,
    completedAt: 0,
    durationMs: 0,
    ...overrides,
  };
}

describe("deriveToolStatus", () => {
  it("maps missing results to running while streaming, pending otherwise", () => {
    expect(deriveToolStatus(call, undefined, true)).toBe("running");
    expect(deriveToolStatus(call, undefined, false)).toBe("pending");
  });

  it("maps permission-required results to waiting-approval", () => {
    expect(
      deriveToolStatus(call, result({ success: false, error: TOOL_PERMISSION_REQUIRED }), true),
    ).toBe("waiting-approval");
  });

  it("maps denied results", () => {
    expect(deriveToolStatus(call, result({ success: false, error: TOOL_DENIED }), true)).toBe(
      "denied",
    );
  });

  it("maps loop/harness blocks and cancellations to blocked", () => {
    for (const error of ["tool_not_allowed", "maxIterations", "loop-detected", "tool_cancelled"]) {
      expect(deriveToolStatus(call, result({ success: false, error }), true)).toBe("blocked");
    }
  });

  it("maps success/failure by result flag", () => {
    expect(deriveToolStatus(call, result({ success: true }), true)).toBe("completed");
    expect(deriveToolStatus(call, result({ success: false, error: "tool_error" }), true)).toBe(
      "failed",
    );
  });

  it("classifies terminal statuses for retry folding", () => {
    expect(isTerminalToolStatus("completed")).toBe(true);
    expect(isTerminalToolStatus("running")).toBe(false);
    expect(isTerminalToolStatus("pending")).toBe(false);
  });
});
