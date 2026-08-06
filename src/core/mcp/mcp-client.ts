import type { HttpMcpServer, McpServerConfig, McpTool, StdioMcpServer } from "./types";

export type { McpTool } from "./types";

export type McpConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ToolResultContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ToolResult {
  content: ToolResultContentBlock[];
  isError?: boolean;
}

export class McpClientError extends Error {}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

interface StdioCommandResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  success: boolean;
}

interface McpTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const PROTOCOL_VERSION = "2024-11-05";
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1000;
const STDIO_TIMEOUT_MS = 30_000;

// Loaded lazily so this module has no static dependency on the Tauri runtime; callers may
// also inject their own InvokeFn (e.g. in tests) instead of relying on this default.
let tauriInvoke: InvokeFn | null = null;

const defaultInvoke: InvokeFn = async (command, args) => {
  if (!tauriInvoke) {
    const module = await import("@tauri-apps/api/core");
    tauriInvoke = module.invoke;
  }
  return tauriInvoke(command, args);
};

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isJsonRpcFailure(response: JsonRpcResponse): response is JsonRpcFailure {
  return "error" in response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeToolResult(result: unknown): ToolResult {
  if (
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    return result as ToolResult;
  }
  return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
}

async function resolveSecretRefs(
  refs: Record<string, string>,
  invoke: InvokeFn,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  await Promise.all(
    Object.entries(refs).map(async ([key, ref]) => {
      const value = await invoke<string | null>("keychain_get", { key: ref });
      if (value !== null) resolved[key] = value;
    }),
  );
  return resolved;
}

function parseSseJsonRpc(text: string, id: number): JsonRpcResponse {
  const dataLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);

  for (let i = dataLines.length - 1; i >= 0; i -= 1) {
    const line = dataLines[i];
    if (!line) continue;
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      continue;
    }
    if (parsed.id === id) return parsed;
  }
  throw new McpClientError("No valid JSON-RPC response received from MCP server");
}

// The desktop backend only exposes a one-shot `run_command` (spawn, wait for exit, capture
// stdout) rather than a persistent stdin/stdout pipe. Each JSON-RPC call is therefore sent as
// a trailing CLI argument and the response is read back from the process's captured stdout.
class StdioTransport implements McpTransport {
  private nextId = 1;
  private envPromise: Promise<Record<string, string>> | null = null;

  constructor(
    private readonly server: StdioMcpServer,
    private readonly invoke: InvokeFn,
  ) {}

  private resolveEnv(): Promise<Record<string, string>> {
    if (!this.envPromise)
      this.envPromise = resolveSecretRefs(this.server.envSecretRefs, this.invoke);
    return this.envPromise;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });
    const env = await this.resolveEnv();

    const result = await this.invoke<StdioCommandResult>("run_command", {
      cwd: this.server.cwd ?? ".",
      program: this.server.command,
      args: [...this.server.args, payload],
      timeoutMs: STDIO_TIMEOUT_MS,
      env,
    });

    if (!result.success) {
      throw new McpClientError(result.stderr.trim() || `MCP server exited with a non-zero status`);
    }
    return parseJsonRpcStdout(result.stdout, id);
  }

  close(): Promise<void> {
    // No persistent process is held open between requests — nothing to tear down.
    return Promise.resolve();
  }
}

function parseJsonRpcStdout(stdout: string, id: number): unknown {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      continue;
    }
    if (parsed.id !== id) continue;
    if (isJsonRpcFailure(parsed)) throw new McpClientError(parsed.error.message);
    return parsed.result;
  }
  throw new McpClientError("No valid JSON-RPC response received from MCP server");
}

class HttpTransport implements McpTransport {
  private nextId = 1;
  private sessionId: string | null = null;
  private headerPromise: Promise<Record<string, string>> | null = null;

  constructor(
    private readonly server: HttpMcpServer,
    private readonly invoke: InvokeFn,
  ) {}

  private resolveSecretHeaders(): Promise<Record<string, string>> {
    if (!this.headerPromise)
      this.headerPromise = resolveSecretRefs(this.server.headerSecretRefs, this.invoke);
    return this.headerPromise;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const secretHeaders = await this.resolveSecretHeaders();
    const headers: Record<string, string> = {
      ...secretHeaders,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    let response: Response;
    try {
      response = await fetch(this.server.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
      });
    } catch (error) {
      throw new McpClientError(error instanceof Error ? error.message : "Network request failed");
    }

    if (!response.ok) {
      throw new McpClientError(`MCP server responded with HTTP ${response.status}`);
    }

    const sessionHeader = response.headers.get("Mcp-Session-Id");
    if (sessionHeader) this.sessionId = sessionHeader;

    const contentType = response.headers.get("Content-Type") ?? "";
    const body: JsonRpcResponse = contentType.includes("text/event-stream")
      ? parseSseJsonRpc(await response.text(), id)
      : ((await response.json()) as JsonRpcResponse);
    if (isJsonRpcFailure(body)) throw new McpClientError(body.error.message);
    return body.result;
  }

  close(): Promise<void> {
    this.sessionId = null;
    return Promise.resolve();
  }
}

export class McpClient {
  private state: McpConnectionState = "disconnected";
  private transport: McpTransport | null = null;
  private tools: McpTool[] = [];
  private server: McpServerConfig | null = null;
  private reconnectAttempts = 0;
  private cancelled = false;
  private readonly stateListeners = new Set<(state: McpConnectionState) => void>();

  constructor(private readonly invoke: InvokeFn = defaultInvoke) {}

  getState(): McpConnectionState {
    return this.state;
  }

  onStateChange(listener: (state: McpConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: McpConnectionState): void {
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  async connect(server: McpServerConfig): Promise<void> {
    this.server = server;
    this.reconnectAttempts = 0;
    this.cancelled = false;
    await this.attemptConnect();
  }

  private async attemptConnect(): Promise<void> {
    if (this.cancelled) return;
    const server = this.server;
    if (!server) throw new McpClientError("No server configured");

    this.setState("connecting");

    if (server.transport === "stdio" && !isDesktopRuntime()) {
      this.setState("error");
      throw new McpClientError("stdio MCP servers require the desktop app");
    }

    const transport: McpTransport =
      server.transport === "stdio"
        ? new StdioTransport(server, this.invoke)
        : new HttpTransport(server, this.invoke);

    try {
      await transport.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "evir", version: "0.1.0" },
      });
      const listResult = (await transport.request("tools/list", {})) as { tools?: McpTool[] };

      this.transport = transport;
      this.tools = listResult.tools ?? [];
      this.reconnectAttempts = 0;
      this.setState("connected");
    } catch (error) {
      await transport.close();
      await this.handleConnectFailure(error);
    }
  }

  private async handleConnectFailure(error: unknown): Promise<void> {
    this.reconnectAttempts += 1;
    if (this.cancelled) return;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.setState("error");
      throw error instanceof Error ? error : new McpClientError(String(error));
    }
    await delay(RECONNECT_DELAY_MS);
    if (this.cancelled) return;
    await this.attemptConnect();
  }

  listTools(): Promise<McpTool[]> {
    return Promise.resolve(this.tools);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.transport || this.state !== "connected") {
      throw new McpClientError("MCP client is not connected");
    }
    try {
      const result = await this.transport.request("tools/call", { name, arguments: args });
      return normalizeToolResult(result);
    } catch (error) {
      this.setState("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelled = true;
    if (this.transport) await this.transport.close();
    this.transport = null;
    this.tools = [];
    this.reconnectAttempts = 0;
    this.setState("disconnected");
  }
}
