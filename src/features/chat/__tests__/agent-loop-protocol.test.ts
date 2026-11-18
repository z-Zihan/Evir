import { describe, expect, it } from "vitest";
import type { ToolCallRecord, ToolResultRecord } from "../../../core/storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../../../core/tools/tool-executor";
import {
  AGENT_TURN_TIMEOUT_MS,
  assistantToolCallWireMessage,
  findBlockedCall,
  parseArguments,
  toolResultWireMessages,
  type CallWithRaw,
} from "../agent-loop-protocol";

function callWithRaw(record: ToolCallRecord): CallWithRaw {
  return { record, rawArguments: JSON.stringify(record.arguments) };
}

function result(overrides: Partial<ToolResultRecord> = {}): ToolResultRecord {
  return {
    toolCallId: "call-1",
    toolName: "read_file",
    success: true,
    output: "ok",
    ...overrides,
  };
}

describe("AGENT_TURN_TIMEOUT_MS", () => {
  it("is two minutes", () => {
    expect(AGENT_TURN_TIMEOUT_MS).toBe(120_000);
  });
});

describe("parseArguments", () => {
  it("returns a parsed JSON object", () => {
    expect(parseArguments('{"path":"a.txt","n":1}')).toEqual({ path: "a.txt", n: 1 });
  });

  it("returns undefined for a JSON array", () => {
    expect(parseArguments("[1,2]")).toBeUndefined();
  });

  it("returns undefined for JSON primitives", () => {
    expect(parseArguments("42")).toBeUndefined();
    expect(parseArguments('"text"')).toBeUndefined();
    expect(parseArguments("null")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseArguments("{not json")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseArguments("")).toBeUndefined();
  });
});

describe("assistantToolCallWireMessage", () => {
  it("maps no calls to an empty tool_calls list", () => {
    expect(assistantToolCallWireMessage("hello", [])).toEqual({
      role: "assistant",
      content: "hello",
      tool_calls: [],
    });
  });

  it("maps each call to the function wire format and passes content through", () => {
    const message = assistantToolCallWireMessage("thinking", [
      { id: "c1", toolName: "read_file", arguments: '{"path":"a"}' },
      { id: "c2", toolName: "run_command", arguments: "{}" },
    ]);
    expect(message).toEqual({
      role: "assistant",
      content: "thinking",
      tool_calls: [
        { id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } },
        { id: "c2", type: "function", function: { name: "run_command", arguments: "{}" } },
      ],
    });
  });
});

describe("toolResultWireMessages", () => {
  it("returns an empty array for no results", () => {
    expect(toolResultWireMessages([])).toEqual([]);
  });

  it("maps results to tool role messages", () => {
    const messages = toolResultWireMessages([
      result({ toolCallId: "c1", toolName: "read_file", output: "file body" }),
      result({ toolCallId: "c2", toolName: "run_command", success: false, output: "boom" }),
    ]);
    expect(messages).toEqual([
      { role: "tool", content: "file body", tool_call_id: "c1", name: "read_file" },
      { role: "tool", content: "boom", tool_call_id: "c2", name: "run_command" },
    ]);
  });
});

describe("findBlockedCall", () => {
  const calls = [
    callWithRaw({ id: "c1", toolName: "read_file", arguments: { path: "a" } }),
    callWithRaw({ id: "c2", toolName: "write_file", arguments: { path: "b", content: "x" } }),
  ];

  it("returns undefined when no result requires permission", () => {
    const results = [
      result({ toolCallId: "c1" }),
      result({ toolCallId: "c2", success: false, error: "other_error" }),
    ];
    expect(findBlockedCall(calls, results)).toBeUndefined();
  });

  it("returns the call matching the blocked result", () => {
    const results = [
      result({ toolCallId: "c1" }),
      result({
        toolCallId: "c2",
        toolName: "write_file",
        success: false,
        error: TOOL_PERMISSION_REQUIRED,
      }),
    ];
    expect(findBlockedCall(calls, results)).toEqual({
      toolCallId: "c2",
      toolName: "write_file",
      args: { path: "b", content: "x" },
    });
  });

  it("returns undefined when the blocked index is outside the calls list", () => {
    const results = [
      result({ toolCallId: "c1" }),
      result({ toolCallId: "c2" }),
      result({ toolCallId: "c3", success: false, error: TOOL_PERMISSION_REQUIRED }),
    ];
    expect(findBlockedCall(calls, results)).toBeUndefined();
  });
});
