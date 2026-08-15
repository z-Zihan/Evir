import { describe, expect, it } from "vitest";
import { parseSseJsonRpc, unwrapJsonRpcResponse } from "../protocol";

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
