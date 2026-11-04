import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_STDIO_NOTIFICATION_EVENT } from "../events";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  MAX_MCP_RESPONSE_BYTES,
  McpProtocolError,
} from "../protocol";
import {
  boundedText,
  consumeNotificationStream,
  eventData,
  HttpMcpTransport,
  StdioMcpTransport,
  type InvokeFn,
  type ListenFn,
} from "../transports";
import type { HttpMcpServer, StdioMcpServer } from "../types";

type Notification = [method: string, params?: Record<string, unknown>];

function streamOf(
  chunks: Array<string | Uint8Array>,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(typeof next === "string" ? encoder.encode(next) : next);
    },
    cancel() {
      onCancel?.();
    },
  });
}

function collector() {
  const seen: Notification[] = [];
  const notify = (method: string, params?: Record<string, unknown>) => {
    seen.push(params === undefined ? [method] : [method, params]);
  };
  return { seen, notify };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

describe("eventData", () => {
  it("joins multiple data lines with newlines", () => {
    expect(eventData('data: {"a":\ndata: 1}')).toBe('{"a":\n1}');
  });

  it("accepts CRLF line endings and ignores non-data fields", () => {
    expect(eventData("event: message\r\nid: 7\r\ndata: hello\r\ndata: world")).toBe("hello\nworld");
  });

  it("returns undefined when the event carries no data lines", () => {
    expect(eventData("event: ping\nid: 1")).toBeUndefined();
    expect(eventData("")).toBeUndefined();
  });

  it("trims leading whitespace after the data: prefix only", () => {
    expect(eventData("data:    padded  ")).toBe("padded  ");
    expect(eventData("data:tight")).toBe("tight");
  });
});

describe("boundedText", () => {
  it("rejects a declared Content-Length above the limit without reading the body", async () => {
    const onCancel = vi.fn();
    const response = new Response(streamOf(["small"], onCancel), {
      headers: { "Content-Length": String(MAX_MCP_RESPONSE_BYTES + 1) },
    });
    await expect(boundedText(response)).rejects.toThrow(McpProtocolError);
    expect(response.bodyUsed).toBe(false);
  });

  it("returns an empty string when the response has no body", async () => {
    await expect(boundedText(new Response(null, { status: 200 }))).resolves.toBe("");
  });

  it("cancels the stream and throws once streamed bytes exceed the limit", async () => {
    const onCancel = vi.fn();
    const half = new Uint8Array(Math.floor(MAX_MCP_RESPONSE_BYTES / 2) + 1);
    const response = new Response(streamOf([half, half, "never read"], onCancel));
    await expect(boundedText(response)).rejects.toThrow("MCP response exceeds the size limit");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("concatenates multiple chunks, including split multi-byte characters", async () => {
    const bytes = new TextEncoder().encode("héllo");
    const response = new Response(streamOf(["{", bytes.slice(0, 2), bytes.slice(2), "}"]));
    await expect(boundedText(response)).resolves.toBe("{héllo}");
  });
});

describe("consumeNotificationStream", () => {
  it("throws when the event stream has no body", async () => {
    await expect(consumeNotificationStream(new Response(null), () => {})).rejects.toThrow(
      "MCP event stream has no response body",
    );
  });

  it("reassembles events split across chunk boundaries and CRLF separators", async () => {
    const { seen, notify } = collector();
    const response = new Response(
      streamOf([
        'data: {"jsonrpc":"2.0","me',
        'thod":"a","params":{"n":1}}\r\n',
        '\r\ndata: {"jsonrpc":"2.0","method":"b"}\n\n',
        'data: {"jsonrpc":"2.0","method":"trailing-without-terminator"}',
      ]),
    );
    await consumeNotificationStream(response, notify);
    expect(seen).toEqual([["a", { n: 1 }], ["b"]]);
  });

  it("throws McpProtocolError on invalid JSON in an event", async () => {
    const response = new Response(streamOf(["data: {not json\n\n"]));
    const error = await consumeNotificationStream(response, () => {}).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(McpProtocolError);
    expect((error as Error).message).toBe("Invalid JSON in MCP event stream");
  });

  it("skips schema-invalid messages and data-less events without throwing", async () => {
    const { seen, notify } = collector();
    const response = new Response(
      streamOf([
        'data: {"jsonrpc":"1.0","method":"wrong-version"}\n\n',
        'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
        ": keepalive comment\n\n",
        'data: {"jsonrpc":"2.0","method":"ok"}\n\n',
      ]),
    );
    await expect(consumeNotificationStream(response, notify)).resolves.toBeUndefined();
    expect(seen).toEqual([["ok"]]);
  });
});

const stdioServer: StdioMcpServer = {
  id: "stdio-1",
  name: "Stdio",
  transport: "stdio",
  enabled: true,
  command: "node",
  args: ["server.mjs"],
  envSecretRefs: {},
};

interface InvokeCall {
  command: string;
  args: Record<string, unknown> | undefined;
}

function fakeInvoke(handler: (command: string, args?: Record<string, unknown>) => unknown) {
  const calls: InvokeCall[] = [];
  const invoke: InvokeFn = <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return Promise.resolve(handler(command, args)) as Promise<T>;
  };
  return { invoke, calls };
}

function fakeListen() {
  const unlisten = vi.fn();
  let handler: ((event: { payload: unknown }) => void) | undefined;
  let subscribedEvent: string | undefined;
  const listen: ListenFn = <T>(event: string, callback: (event: { payload: T }) => void) => {
    subscribedEvent = event;
    handler = callback as (event: { payload: unknown }) => void;
    return Promise.resolve(unlisten);
  };
  return {
    listen,
    unlisten,
    emit: (payload: unknown) => handler?.({ payload }),
    subscribedEvent: () => subscribedEvent,
  };
}

function defaultStdioHandler(command: string, args?: Record<string, unknown>): unknown {
  if (command === "mcp_stdio_start") return { pid: 4242 };
  if (command === "mcp_stdio_request") {
    const request = args?.request as { id: number };
    return { jsonrpc: "2.0", id: request.id, result: { echoed: true } };
  }
  return undefined;
}

describe("StdioMcpTransport", () => {
  it("resolves envSecretRefs through keychain_get and injects them into the spawn env", async () => {
    const { invoke, calls } = fakeInvoke((command, args) => {
      if (command === "keychain_get") return args?.key === "ref-present" ? "s3cret" : null;
      return defaultStdioHandler(command, args);
    });
    const { listen } = fakeListen();
    const transport = await StdioMcpTransport.open(
      { ...stdioServer, envSecretRefs: { API_KEY: "ref-present", MISSING: "ref-absent" } },
      invoke,
      listen,
    );

    expect(transport.pid).toBe(4242);
    expect(calls.filter((call) => call.command === "keychain_get")).toHaveLength(2);
    const start = calls.find((call) => call.command === "mcp_stdio_start");
    expect(start?.args).toEqual({
      request: {
        serverId: "stdio-1",
        command: "node",
        args: ["server.mjs"],
        cwd: null,
        env: { API_KEY: "s3cret" },
      },
    });
  });

  it("returns the unwrapped JSON-RPC result with incrementing ids and the default timeout", async () => {
    const { invoke, calls } = fakeInvoke(defaultStdioHandler);
    const transport = await StdioMcpTransport.open(stdioServer, invoke, fakeListen().listen);

    await expect(transport.request("tools/list", { cursor: "c" })).resolves.toEqual({
      echoed: true,
    });
    await transport.request("ping");
    const requests = calls.filter((call) => call.command === "mcp_stdio_request");
    expect(requests.map((call) => call.args)).toEqual([
      {
        serverId: "stdio-1",
        request: { jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "c" } },
        timeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS,
      },
      {
        serverId: "stdio-1",
        request: { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
        timeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS,
      },
    ]);
  });

  it("rejects request and notify with McpProtocolError after close", async () => {
    const { invoke } = fakeInvoke(defaultStdioHandler);
    const transport = await StdioMcpTransport.open(stdioServer, invoke, fakeListen().listen);
    await transport.close();

    await expect(transport.request("ping")).rejects.toBeInstanceOf(McpProtocolError);
    await expect(transport.notify("notifications/initialized")).rejects.toBeInstanceOf(
      McpProtocolError,
    );
  });

  it("dispatches notification events only for the matching serverId and valid payloads", async () => {
    const { invoke } = fakeInvoke(defaultStdioHandler);
    const events = fakeListen();
    const transport = await StdioMcpTransport.open(stdioServer, invoke, events.listen);
    const { seen, notify } = collector();
    transport.onNotification(notify);

    expect(events.subscribedEvent()).toBe(MCP_STDIO_NOTIFICATION_EVENT);
    events.emit({ serverId: "other", message: { jsonrpc: "2.0", method: "foreign" } });
    events.emit({ serverId: "stdio-1", message: { jsonrpc: "2.0" } });
    events.emit("garbage");
    events.emit({
      serverId: "stdio-1",
      message: { jsonrpc: "2.0", method: "notifications/progress", params: { p: 1 } },
    });
    expect(seen).toEqual([["notifications/progress", { p: 1 }]]);
  });

  it("closes idempotently, stopping the process and unlistening exactly once", async () => {
    const { invoke, calls } = fakeInvoke(defaultStdioHandler);
    const events = fakeListen();
    const transport = await StdioMcpTransport.open(stdioServer, invoke, events.listen);
    const { seen, notify } = collector();
    transport.onNotification(notify);

    await transport.close();
    await transport.close();
    events.emit({ serverId: "stdio-1", message: { jsonrpc: "2.0", method: "late" } });

    expect(calls.filter((call) => call.command === "mcp_stdio_stop")).toEqual([
      { command: "mcp_stdio_stop", args: { serverId: "stdio-1" } },
    ]);
    expect(events.unlisten).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it("closes the transport when an in-flight request is aborted externally", async () => {
    const never = new Promise<never>(() => {});
    const { invoke, calls } = fakeInvoke((command, args) =>
      command === "mcp_stdio_request" ? never : defaultStdioHandler(command, args),
    );
    const transport = await StdioMcpTransport.open(stdioServer, invoke, fakeListen().listen);
    const controller = new AbortController();

    const pending = transport.request("tools/call", {}, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.some((call) => call.command === "mcp_stdio_stop")).toBe(true);
    await expect(transport.request("ping")).rejects.toBeInstanceOf(McpProtocolError);
  });
});

const httpServer: HttpMcpServer = {
  id: "http-1",
  name: "Http",
  transport: "streamable-http",
  enabled: true,
  url: "https://mcp.example.test/mcp",
  headerSecretRefs: {},
};

type FetchHandler = (init: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.resolve(handler(init)));
  vi.stubGlobal("fetch", fetchMock);
  const callsFor = (method: string) =>
    fetchMock.mock.calls.filter(([, init]) => init.method === method).map(([, init]) => init);
  const headersOf = (init: RequestInit | undefined) => init?.headers as Record<string, string>;
  return { fetchMock, callsFor, headersOf };
}

function jsonRpcResult(init: RequestInit, result: unknown, headers: Record<string, string> = {}) {
  const body = JSON.parse(init.body as string) as { id: number };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("HttpMcpTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects resolved headerSecretRefs into request headers", async () => {
    const { headersOf, callsFor } = stubFetch((init) => jsonRpcResult(init, {}));
    const { invoke } = fakeInvoke((command, args) =>
      command === "keychain_get" && args?.key === "ref-token" ? "Bearer abc" : null,
    );
    const transport = new HttpMcpTransport(
      { ...httpServer, headerSecretRefs: { Authorization: "ref-token", "X-Missing": "ref-none" } },
      invoke,
    );

    await transport.request("ping");
    const headers = headersOf(callsFor("POST")[0]);
    expect(headers).toMatchObject({
      Authorization: "Bearer abc",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    });
    expect(headers).not.toHaveProperty("X-Missing");
  });

  it("rejects when header secret refs exist but no invoke bridge is provided", async () => {
    const { fetchMock } = stubFetch((init) => jsonRpcResult(init, {}));
    const transport = new HttpMcpTransport({
      ...httpServer,
      headerSecretRefs: { Authorization: "ref-token" },
    });

    await expect(transport.request("ping")).rejects.toThrow(
      "MCP secret references require a desktop keychain (invoke) bridge",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures Mcp-Session-Id and echoes it with the protocol version on later requests", async () => {
    const { callsFor, headersOf } = stubFetch((init) =>
      init.method === "GET"
        ? new Response(null, { status: 405 })
        : jsonRpcResult(init, { ok: true }, { "Mcp-Session-Id": "session-9" }),
    );
    const transport = new HttpMcpTransport(httpServer);

    await expect(transport.request("initialize")).resolves.toEqual({ ok: true });
    transport.setProtocolVersion("2025-06-18");
    await transport.request("tools/list");

    const [first, second] = callsFor("POST");
    expect(headersOf(first)).not.toHaveProperty("Mcp-Session-Id");
    expect(headersOf(second)).toMatchObject({
      "Mcp-Session-Id": "session-9",
      "MCP-Protocol-Version": "2025-06-18",
    });
  });

  it("throws an HTTP status error for non-ok responses", async () => {
    stubFetch(() => new Response("nope", { status: 503 }));
    const transport = new HttpMcpTransport(httpServer);

    await expect(transport.request("ping")).rejects.toThrow("MCP server responded with HTTP 503");
  });

  it("throws McpProtocolError for an invalid JSON response body", async () => {
    stubFetch(() => new Response("<html>", { headers: { "Content-Type": "application/json" } }));
    const transport = new HttpMcpTransport(httpServer);

    await expect(transport.request("ping")).rejects.toThrow(
      "Invalid JSON response from MCP server",
    );
  });

  it("parses SSE POST responses, dispatching interleaved notifications", async () => {
    stubFetch(
      () =>
        new Response(
          'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"p":0.5}}\n\n' +
            'data: {"jsonrpc":"2.0","id":1,"result":{"done":true}}\n\n',
          { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        ),
    );
    const transport = new HttpMcpTransport(httpServer);
    const { seen, notify } = collector();
    transport.onNotification(notify);

    await expect(transport.request("tools/call")).resolves.toEqual({ done: true });
    expect(seen).toEqual([["notifications/progress", { p: 0.5 }]]);
  });

  it.each([202, 204])("notify passes through a %i response without a body", async (status) => {
    const { callsFor } = stubFetch(() => new Response(null, { status }));
    const transport = new HttpMcpTransport(httpServer);

    await expect(transport.notify("notifications/initialized")).resolves.toBeUndefined();
    expect(JSON.parse(callsFor("POST")[0]?.body as string)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
  });

  it("throws AbortError immediately without fetching when the signal is already aborted", async () => {
    const { fetchMock } = stubFetch((init) => jsonRpcResult(init, {}));
    const transport = new HttpMcpTransport(httpServer);
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.request("ping", {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([404, 405])(
    "event stream GET with %i ends silently without transport_closed",
    async (status) => {
      const { callsFor, headersOf } = stubFetch(() => new Response(null, { status }));
      const transport = new HttpMcpTransport(httpServer);
      const { seen, notify } = collector();
      transport.onNotification(notify);

      transport.setProtocolVersion("2025-06-18");
      await flush();

      expect(headersOf(callsFor("GET")[0])).toMatchObject({
        Accept: "text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      });
      expect(seen).toEqual([]);
    },
  );

  it.each([
    ["HTTP 500", () => new Response(null, { status: 500 })],
    [
      "an unsupported content type",
      () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ],
  ])("event stream failure with %s emits evir/transport_closed", async (_label, respond) => {
    stubFetch(respond);
    const transport = new HttpMcpTransport(httpServer);
    const { seen, notify } = collector();
    transport.onNotification(notify);

    transport.setProtocolVersion("2025-06-18");
    await vi.waitFor(() => expect(seen).toEqual([["evir/transport_closed"]]));
  });

  it("forwards event stream notifications and reports transport_closed when it ends", async () => {
    stubFetch(
      () =>
        new Response(
          streamOf(['data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n']),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const transport = new HttpMcpTransport(httpServer);
    const { seen, notify } = collector();
    transport.onNotification(notify);

    transport.setProtocolVersion("2025-06-18");
    await vi.waitFor(() =>
      expect(seen).toEqual([["notifications/tools/list_changed"], ["evir/transport_closed"]]),
    );
  });

  it("closes idempotently, sending one DELETE with the session id", async () => {
    const { callsFor, headersOf } = stubFetch((init) =>
      init.method === "DELETE"
        ? new Response(null, { status: 200 })
        : jsonRpcResult(init, {}, { "Mcp-Session-Id": "session-1" }),
    );
    const transport = new HttpMcpTransport(httpServer);
    await transport.request("initialize");

    await transport.close();
    await transport.close();

    const deletes = callsFor("DELETE");
    expect(deletes).toHaveLength(1);
    expect(headersOf(deletes[0])).toMatchObject({ "Mcp-Session-Id": "session-1" });
    await expect(transport.request("ping")).rejects.toThrow("MCP transport is closed");
  });

  it("skips DELETE without a session and swallows DELETE failures", async () => {
    const withoutSession = stubFetch(() => new Response(null, { status: 200 }));
    await new HttpMcpTransport(httpServer).close();
    expect(withoutSession.fetchMock).not.toHaveBeenCalled();

    const failing = stubFetch((init) => {
      if (init.method !== "DELETE") return jsonRpcResult(init, {}, { "Mcp-Session-Id": "s" });
      throw new TypeError("network down");
    });
    const transport = new HttpMcpTransport(httpServer);
    await transport.request("initialize");

    await expect(transport.close()).resolves.toBeUndefined();
    expect(failing.callsFor("DELETE")).toHaveLength(1);
  });

  it("aborts the live event stream on close without emitting transport_closed", async () => {
    const opened = deferred<void>();
    stubFetch((init) => {
      if (init.method !== "GET") return new Response(null, { status: 200 });
      opened.resolve();
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason));
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });
    const transport = new HttpMcpTransport(httpServer);
    const { seen, notify } = collector();
    transport.onNotification(notify);

    transport.setProtocolVersion("2025-06-18");
    await opened.promise;
    await transport.close();

    expect(seen).toEqual([]);
  });
});
