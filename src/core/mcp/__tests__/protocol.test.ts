import { describe, expect, it, vi } from "vitest";
import {
  MAX_MCP_RESOURCE_COUNT,
  MAX_MCP_TOOL_COUNT,
  McpProtocolError,
  parseCallToolResult,
  parseInitializeResult,
  parseListResourcesResult,
  parseListToolsResult,
  parseReadResourceResult,
  parseSseJsonRpc,
  unwrapJsonRpcResponse,
} from "../protocol";

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

const validTool = {
  name: "read_file",
  description: "Read a file",
  inputSchema: { type: "object" },
};
const validResource = { uri: "file:///a.txt", name: "a.txt" };

describe("MCP protocol parsing", () => {
  it("joins multiline SSE data and returns the matching JSON-RPC result", () => {
    const stream =
      'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":7,"result":{"ok":true}}\n\n';
    expect(parseSseJsonRpc(stream, 7)).toEqual({ ok: true });
  });

  it("rejects mismatched ids and server errors", () => {
    expect(() => unwrapJsonRpcResponse({ jsonrpc: "2.0", id: 8, result: {} }, 7)).toThrow(
      "response id mismatch",
    );
    expect(() =>
      unwrapJsonRpcResponse(
        { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "missing" } },
        7,
      ),
    ).toThrow("missing");
  });
});

describe("McpProtocolError", () => {
  it("is a named Error carrying an optional code", () => {
    const error = new McpProtocolError("boom", -32000);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("McpProtocolError");
    expect(error.message).toBe("boom");
    expect(error.code).toBe(-32000);
    expect(new McpProtocolError("no code").code).toBeUndefined();
  });
});

describe("parseSseJsonRpc", () => {
  it("skips an event with a mismatched id and returns a later matching event", () => {
    const stream = [
      'data: {"jsonrpc":"2.0","id":3,"result":{"stale":true}}',
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      "",
    ].join("\n\n");
    expect(parseSseJsonRpc(stream, 7)).toEqual({ ok: true });
  });

  it("throws the server error for a matching JSON-RPC error response", () => {
    const stream =
      'data: {"jsonrpc":"2.0","id":7,"error":{"code":-32602,"message":"bad params"}}\n\n';
    const error = captureError(() => parseSseJsonRpc(stream, 7));
    expect(error).toBeInstanceOf(McpProtocolError);
    expect((error as McpProtocolError).message).toBe("bad params");
    expect((error as McpProtocolError).code).toBe(-32602);
  });

  it("ignores invalid JSON data and still returns a later matching event", () => {
    const stream = [
      "data: {not json",
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      "",
    ].join("\n\n");
    expect(parseSseJsonRpc(stream, 7)).toEqual({ ok: true });
  });

  it("dispatches notifications and continues to the response in the same stream", () => {
    const onNotification = vi.fn();
    const stream = [
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      "",
    ].join("\n\n");
    expect(parseSseJsonRpc(stream, 7, onNotification)).toEqual({ ok: true });
    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith("notifications/progress", { progress: 1 });
  });

  it("dispatches notifications without params as undefined params", () => {
    const onNotification = vi.fn();
    const stream = [
      'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
      'data: {"jsonrpc":"2.0","id":7,"result":{}}',
      "",
    ].join("\n\n");
    expect(parseSseJsonRpc(stream, 7, onNotification)).toEqual({});
    expect(onNotification).toHaveBeenCalledWith("notifications/tools/list_changed", undefined);
  });

  it("throws when the stream has no matching response", () => {
    const stream = [
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      'data: {"jsonrpc":"2.0","id":3,"result":{}}',
      "event: ping",
      "",
    ].join("\n\n");
    expect(() => parseSseJsonRpc(stream, 7)).toThrow(
      "No matching JSON-RPC response in MCP event stream",
    );
    expect(() => parseSseJsonRpc("", 7)).toThrow(McpProtocolError);
  });

  it("handles CRLF line endings with multiline data", () => {
    const stream =
      'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":7,"result":{"ok":true}}\r\n\r\n';
    expect(parseSseJsonRpc(stream, 7)).toEqual({ ok: true });
  });

  it("joins multiple data lines independently per event", () => {
    const stream = [
      'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":3,"result":{"stale":true}}',
      'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":7,\ndata: "result":{"ok":true}}',
      "",
    ].join("\n\n");
    expect(parseSseJsonRpc(stream, 7)).toEqual({ ok: true });
  });
});

describe("unwrapJsonRpcResponse", () => {
  it.each([
    ["missing jsonrpc", { id: 7, result: {} }],
    ["missing id", { jsonrpc: "2.0", result: {} }],
    ["error without code", { jsonrpc: "2.0", id: 7, error: { message: "x" } }],
    ["non-object input", "not an object"],
    ["null input", null],
  ])("rejects %s", (_label, value) => {
    expect(() => unwrapJsonRpcResponse(value, 7)).toThrow(
      "Invalid JSON-RPC response from MCP server",
    );
  });

  it("throws on id mismatch", () => {
    expect(() => unwrapJsonRpcResponse({ jsonrpc: "2.0", id: "7", result: {} }, 7)).toThrow(
      "MCP response id mismatch",
    );
  });

  it("throws McpProtocolError carrying the server message and code", () => {
    const error = captureError(() =>
      unwrapJsonRpcResponse(
        { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not found" } },
        7,
      ),
    );
    expect(error).toBeInstanceOf(McpProtocolError);
    expect((error as McpProtocolError).message).toBe("Method not found");
    expect((error as McpProtocolError).code).toBe(-32601);
  });

  it("returns the result payload on success", () => {
    expect(unwrapJsonRpcResponse({ jsonrpc: "2.0", id: 7, result: { tools: [] } }, 7)).toEqual({
      tools: [],
    });
  });
});

describe("parseInitializeResult", () => {
  const minimal = {
    protocolVersion: "2025-06-18",
    capabilities: {},
    serverInfo: { name: "demo" },
  };

  it("parses a minimal result without instructions", () => {
    const result = parseInitializeResult(minimal);
    expect(result).toEqual(minimal);
    expect("instructions" in result).toBe(false);
  });

  it("includes optional instructions when present", () => {
    const result = parseInitializeResult({ ...minimal, instructions: "Use carefully" });
    expect(result.instructions).toBe("Use carefully");
  });

  it.each([
    ["missing protocolVersion", { capabilities: {}, serverInfo: { name: "demo" } }],
    ["missing capabilities", { protocolVersion: "2025-06-18", serverInfo: { name: "demo" } }],
    ["empty serverInfo.name", { ...minimal, serverInfo: { name: "" } }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseInitializeResult(value)).toThrow("Invalid MCP initialize result");
  });
});

describe("parseListToolsResult", () => {
  it("parses a single tool without nextCursor", () => {
    const result = parseListToolsResult({ tools: [validTool] });
    expect(result.tools).toEqual([validTool]);
    expect("nextCursor" in result).toBe(false);
  });

  it("includes nextCursor when present", () => {
    expect(parseListToolsResult({ tools: [validTool], nextCursor: "page-2" }).nextCursor).toBe(
      "page-2",
    );
  });

  it("rejects more than MAX_MCP_TOOL_COUNT tools", () => {
    const tools = Array.from({ length: MAX_MCP_TOOL_COUNT + 1 }, (_, index) => ({
      ...validTool,
      name: `tool_${index}`,
    }));
    expect(() => parseListToolsResult({ tools })).toThrow("Invalid MCP tools/list result");
  });

  it.each([
    ["empty name", { ...validTool, name: "" }],
    ["missing inputSchema", { name: "read_file" }],
    ["description over 20000 chars", { ...validTool, description: "x".repeat(20_001) }],
  ])("rejects a tool with %s", (_label, tool) => {
    expect(() => parseListToolsResult({ tools: [tool] })).toThrow("Invalid MCP tools/list result");
  });
});

describe("parseListResourcesResult", () => {
  it("parses a resource with optional fields and no nextCursor", () => {
    const resource = { ...validResource, description: "A file", mimeType: "text/plain" };
    const result = parseListResourcesResult({ resources: [resource] });
    expect(result.resources).toEqual([resource]);
    expect("nextCursor" in result).toBe(false);
  });

  it("parses a minimal resource with nextCursor", () => {
    const result = parseListResourcesResult({ resources: [validResource], nextCursor: "next" });
    expect(result.resources).toEqual([validResource]);
    expect(result.nextCursor).toBe("next");
  });

  it("rejects more than MAX_MCP_RESOURCE_COUNT resources", () => {
    const resources = Array.from({ length: MAX_MCP_RESOURCE_COUNT + 1 }, (_, index) => ({
      uri: `file:///${index}.txt`,
      name: `${index}.txt`,
    }));
    expect(() => parseListResourcesResult({ resources })).toThrow(
      "Invalid MCP resources/list result",
    );
  });

  it.each([
    ["empty name", { ...validResource, name: "" }],
    ["missing uri", { name: "a.txt" }],
  ])("rejects a resource with %s", (_label, resource) => {
    expect(() => parseListResourcesResult({ resources: [resource] })).toThrow(
      "Invalid MCP resources/list result",
    );
  });
});

describe("parseReadResourceResult", () => {
  it("returns text with mimeType when present", () => {
    expect(
      parseReadResourceResult({
        contents: [{ uri: "file:///a.txt", mimeType: "text/plain", text: "hello" }],
      }),
    ).toEqual({ text: "hello", mimeType: "text/plain" });
  });

  it("omits the mimeType key when absent", () => {
    const result = parseReadResourceResult({ contents: [{ uri: "file:///a.txt", text: "hi" }] });
    expect(result).toEqual({ text: "hi" });
    expect("mimeType" in result).toBe(false);
  });

  it("rejects binary blob content", () => {
    expect(() =>
      parseReadResourceResult({ contents: [{ uri: "file:///a.png", blob: "AAAA" }] }),
    ).toThrow("binary");
  });

  it("rejects an empty contents array", () => {
    expect(() => parseReadResourceResult({ contents: [] })).toThrow(
      "Invalid MCP resources/read result",
    );
  });
});

describe("parseCallToolResult", () => {
  const content = [{ type: "text", text: "done" }];

  it("returns content only without an isError key", () => {
    const result = parseCallToolResult({ content });
    expect(result).toEqual({ content });
    expect("isError" in result).toBe(false);
    expect("structuredContent" in result).toBe(false);
  });

  it("preserves isError when true", () => {
    expect(parseCallToolResult({ content, isError: true })).toEqual({ content, isError: true });
  });

  it("preserves structuredContent when present", () => {
    expect(parseCallToolResult({ content, structuredContent: { count: 2 } })).toEqual({
      content,
      structuredContent: { count: 2 },
    });
  });

  it("rejects a result missing the content array", () => {
    expect(() => parseCallToolResult({ isError: false })).toThrow("Invalid MCP tools/call result");
  });
});
