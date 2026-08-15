import { z } from "zod";
import type { HttpMcpServer, StdioMcpServer } from "./types";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  MAX_MCP_RESPONSE_BYTES,
  McpNotificationSchema,
  McpProtocolError,
  parseSseJsonRpc,
  unwrapJsonRpcResponse,
} from "./protocol";

export interface McpRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpTransport {
  request(
    method: string,
    params?: Record<string, unknown>,
    options?: McpRequestOptions,
  ): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  onNotification(listener: (method: string, params?: Record<string, unknown>) => void): () => void;
  setProtocolVersion(version: string): void;
  close(): Promise<void>;
  readonly pid?: number;
}

export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type ListenFn = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

let tauriInvoke: InvokeFn | undefined;
let tauriListen: ListenFn | undefined;

export const defaultInvoke: InvokeFn = async (command, args) => {
  if (!tauriInvoke) tauriInvoke = (await import("@tauri-apps/api/core")).invoke;
  return tauriInvoke(command, args);
};

const defaultListen: ListenFn = async (event, handler) => {
  if (!tauriListen) tauriListen = (await import("@tauri-apps/api/event")).listen;
  return tauriListen(event, handler);
};

async function resolveSecretRefs(
  refs: Record<string, string>,
  invoke: InvokeFn,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  await Promise.all(
    Object.entries(refs).map(async ([key, reference]) => {
      const value = await invoke<string | null>("keychain_get", { key: reference });
      if (value !== null) resolved[key] = value;
    }),
  );
  return resolved;
}

function abortError(): DOMException {
  return new DOMException("MCP request cancelled", "AbortError");
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  abort: () => void,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    abort();
    throw abortError();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      abort();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const StdioNotificationEventSchema = z.object({
  serverId: z.string(),
  message: McpNotificationSchema,
});

export class StdioMcpTransport implements McpTransport {
  private nextId = 1;
  private notificationListeners = new Set<
    (method: string, params?: Record<string, unknown>) => void
  >();
  private unlisten: (() => void) | undefined;
  private closed = false;
  private constructor(
    private readonly server: StdioMcpServer,
    private readonly invoke: InvokeFn,
    readonly pid: number,
  ) {}

  static async open(
    server: StdioMcpServer,
    invoke: InvokeFn = defaultInvoke,
    listen: ListenFn = defaultListen,
  ): Promise<StdioMcpTransport> {
    const env = await resolveSecretRefs(server.envSecretRefs, invoke);
    const started = await invoke<{ pid: number }>("mcp_stdio_start", {
      request: {
        serverId: server.id,
        command: server.command,
        args: server.args,
        cwd: server.cwd ?? null,
        env,
      },
    });
    const transport = new StdioMcpTransport(server, invoke, started.pid);
    transport.unlisten = await listen<unknown>("mcp-stdio-notification", (event) => {
      const parsed = StdioNotificationEventSchema.safeParse(event.payload);
      if (!parsed.success || parsed.data.serverId !== server.id) return;
      for (const listener of transport.notificationListeners) {
        listener(parsed.data.message.method, parsed.data.message.params);
      }
    });
    return transport;
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    if (this.closed) throw new McpProtocolError("MCP transport is closed");
    const id = this.nextId++;
    const request = { jsonrpc: "2.0", id, method, params };
    const pending = this.invoke<unknown>("mcp_stdio_request", {
      serverId: this.server.id,
      request,
      timeoutMs: options.timeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
    });
    const response = await withAbort(pending, options.signal, () => {
      void this.close();
    });
    return unwrapJsonRpcResponse(response, id);
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    if (this.closed) throw new McpProtocolError("MCP transport is closed");
    await this.invoke("mcp_stdio_send", {
      serverId: this.server.id,
      message: { jsonrpc: "2.0", method, params },
    });
  }

  onNotification(listener: (method: string, params?: Record<string, unknown>) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  setProtocolVersion(): void {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unlisten?.();
    this.unlisten = undefined;
    this.notificationListeners.clear();
    await this.invoke("mcp_stdio_stop", { serverId: this.server.id });
  }
}

async function boundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("Content-Length");
  const length = declaredLength === null ? undefined : Number(declaredLength);
  if (length !== undefined && Number.isFinite(length) && length > MAX_MCP_RESPONSE_BYTES) {
    throw new McpProtocolError("MCP response exceeds the size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MCP_RESPONSE_BYTES) {
        await reader.cancel();
        throw new McpProtocolError("MCP response exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function eventData(event: string): string | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || undefined;
}

async function consumeNotificationStream(
  response: Response,
  notify: (method: string, params?: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.body) throw new McpProtocolError("MCP event stream has no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > MAX_MCP_RESPONSE_BYTES) {
        throw new McpProtocolError("MCP event exceeds the size limit");
      }
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = eventData(event);
        if (!data) continue;
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          throw new McpProtocolError("Invalid JSON in MCP event stream");
        }
        const parsed = McpNotificationSchema.safeParse(value);
        if (!parsed.success) continue;
        notify(parsed.data.method, parsed.data.params);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class HttpMcpTransport implements McpTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  private protocolVersion: string | undefined;
  private closed = false;
  private readonly headerPromise: Promise<Record<string, string>>;
  private readonly notificationListeners = new Set<
    (method: string, params?: Record<string, unknown>) => void
  >();
  private eventStreamAbort: AbortController | undefined;
  private eventStream: Promise<void> | undefined;

  constructor(
    private readonly server: HttpMcpServer,
    invoke: InvokeFn = defaultInvoke,
  ) {
    this.headerPromise = resolveSecretRefs(server.headerSecretRefs, invoke);
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      ...(await this.headerPromise),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
    };
  }

  private emitNotification(method: string, params?: Record<string, unknown>): void {
    for (const listener of this.notificationListeners) listener(method, params);
  }

  private async post<T>(
    body: unknown,
    options: McpRequestOptions,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new McpProtocolError("MCP transport is closed");
    if (options.signal?.aborted) throw abortError();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(this.server.url, {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new McpProtocolError(`MCP server responded with HTTP ${response.status}`);
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) this.sessionId = sessionId;
      return await consume(response);
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (timedOut) throw new McpProtocolError("MCP request timed out");
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: McpRequestOptions = {},
  ): Promise<unknown> {
    const id = this.nextId++;
    return this.post({ jsonrpc: "2.0", id, method, params }, options, async (response) => {
      const text = await boundedText(response);
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("text/event-stream")) {
        return parseSseJsonRpc(text, id, (notificationMethod, notificationParams) =>
          this.emitNotification(notificationMethod, notificationParams),
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new McpProtocolError("Invalid JSON response from MCP server");
      }
      return unwrapJsonRpcResponse(parsed, id);
    });
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params }, {}, async (response) => {
      if (response.status === 202 || response.status === 204) return;
      await boundedText(response);
    });
  }

  onNotification(listener: (method: string, params?: Record<string, unknown>) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
    this.startEventStream();
  }

  private startEventStream(): void {
    if (this.closed || this.eventStream) return;
    const controller = new AbortController();
    this.eventStreamAbort = controller;
    this.eventStream = (async () => {
      const response = await fetch(this.server.url, {
        method: "GET",
        headers: { ...(await this.headers()), Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (response.status === 404 || response.status === 405) return;
      if (!response.ok) {
        throw new McpProtocolError(`MCP event stream responded with HTTP ${response.status}`);
      }
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        throw new McpProtocolError("MCP event stream returned an unsupported content type");
      }
      await consumeNotificationStream(response, (method, params) =>
        this.emitNotification(method, params),
      );
      if (!this.closed) this.emitNotification("evir/transport_closed");
    })()
      .catch(() => {
        if (!this.closed && !controller.signal.aborted) {
          this.emitNotification("evir/transport_closed");
        }
      })
      .finally(() => {
        if (this.eventStreamAbort === controller) {
          this.eventStreamAbort = undefined;
          this.eventStream = undefined;
        }
      });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.eventStreamAbort?.abort();
    await this.eventStream;
    this.notificationListeners.clear();
    if (this.sessionId) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(
        () => controller.abort(),
        DEFAULT_MCP_REQUEST_TIMEOUT_MS,
      );
      try {
        await fetch(this.server.url, {
          method: "DELETE",
          headers: await this.headers(),
          signal: controller.signal,
        });
      } catch {
        // Session deletion is best effort after local ownership has ended.
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
    this.sessionId = undefined;
  }
}
