import type { McpServerConfig, McpTool } from "./types";
import {
  MCP_PROTOCOL_VERSION,
  MAX_MCP_DISCOVERY_PAGES,
  MAX_MCP_SCHEMA_BYTES,
  MAX_MCP_TOOL_COUNT,
  McpProtocolError,
  parseCallToolResult,
  parseInitializeResult,
  parseListToolsResult,
  type McpCallToolResult,
  type McpInitializeResult,
} from "./protocol";
import {
  HttpMcpTransport,
  StdioMcpTransport,
  type InvokeFn,
  type ListenFn,
  type McpRequestOptions,
  type McpTransport,
} from "./transports";

export type { McpTool } from "./types";
export type { InvokeFn, ListenFn, McpTransport } from "./transports";
export type { McpCallToolResult } from "./protocol";

export type McpConnectionState =
  | "disconnected"
  | "starting"
  | "initializing"
  | "discovering"
  | "ready"
  | "reconnecting"
  | "stopping"
  | "error";

export interface McpClientSnapshot {
  state: McpConnectionState;
  tools: readonly McpTool[];
  serverInfo?: McpInitializeResult["serverInfo"] | undefined;
  capabilities?: Record<string, unknown> | undefined;
  protocolVersion?: string | undefined;
  pid?: number | undefined;
  lastReadyAt?: number | undefined;
  error?: string | undefined;
}

export class McpClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpClientError";
  }
}

export interface McpClientDependencies {
  invoke?: InvokeFn;
  listen?: ListenFn;
  openTransport?: (server: McpServerConfig) => Promise<McpTransport>;
}

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "MCP operation failed";
}

export class McpClient {
  private snapshot: McpClientSnapshot = { state: "disconnected", tools: [] };
  private transport: McpTransport | undefined;
  private generation = 0;
  private readonly listeners = new Set<(snapshot: McpClientSnapshot) => void>();
  private notificationDisposer: (() => void) | undefined;
  private readonly dependencies: McpClientDependencies;

  constructor(dependencies: McpClientDependencies | InvokeFn = {}) {
    this.dependencies =
      typeof dependencies === "function" ? { invoke: dependencies } : dependencies;
  }

  getSnapshot(): McpClientSnapshot {
    return this.snapshot;
  }

  getState(): McpConnectionState {
    return this.snapshot.state;
  }

  onStateChange(listener: (state: McpConnectionState) => void): () => void {
    return this.subscribe((snapshot) => listener(snapshot.state));
  }

  subscribe(listener: (snapshot: McpClientSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(update: Partial<McpClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private async openTransport(server: McpServerConfig): Promise<McpTransport> {
    if (this.dependencies.openTransport) return this.dependencies.openTransport(server);
    if (server.transport === "stdio") {
      if (!isDesktopRuntime())
        throw new McpClientError("stdio MCP servers require the desktop app");
      // Stdio needs the desktop IPC bridge for spawn + keychain secrets; the
      // runtime injects both (there is no in-core default anymore).
      if (!this.dependencies.invoke || !this.dependencies.listen) {
        throw new McpClientError(
          "stdio MCP servers require the desktop invoke/listen bridge to be injected",
        );
      }
      return StdioMcpTransport.open(server, this.dependencies.invoke, this.dependencies.listen);
    }
    return new HttpMcpTransport(server, this.dependencies.invoke);
  }

  async connect(server: McpServerConfig, options: McpRequestOptions = {}): Promise<void> {
    await this.disconnect();
    const generation = ++this.generation;
    this.publish({ state: "starting", tools: [], error: undefined });
    let transport: McpTransport | undefined;
    try {
      transport = await this.openTransport(server);
      if (generation !== this.generation) {
        await transport.close();
        return;
      }
      this.transport = transport;
      let toolsChangedDuringStartup = false;
      this.notificationDisposer = transport.onNotification((method) => {
        if (
          (method === "evir/process_exited" || method === "evir/transport_closed") &&
          generation === this.generation
        ) {
          this.failConnection(
            method === "evir/process_exited" ? "MCP server process exited" : "MCP transport closed",
          );
          return;
        }
        if (method !== "notifications/tools/list_changed" || generation !== this.generation) return;
        if (this.snapshot.state === "ready") void this.refreshTools(generation);
        else toolsChangedDuringStartup = true;
      });
      this.publish({ state: "initializing", pid: transport.pid });
      const initialize = parseInitializeResult(
        await transport.request(
          "initialize",
          {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "evir", version: "0.1.0" },
          },
          options,
        ),
      );
      if (initialize.protocolVersion !== MCP_PROTOCOL_VERSION) {
        throw new McpProtocolError(
          `Unsupported MCP protocol version: ${initialize.protocolVersion}`,
        );
      }
      transport.setProtocolVersion(initialize.protocolVersion);
      await transport.notify("notifications/initialized");
      this.publish({ state: "discovering" });
      const tools = await this.discoverTools(transport, options);
      if (generation !== this.generation) return;
      this.publish({
        state: "ready",
        tools,
        serverInfo: initialize.serverInfo,
        capabilities: initialize.capabilities,
        protocolVersion: initialize.protocolVersion,
        lastReadyAt: Date.now(),
        error: undefined,
      });
      if (toolsChangedDuringStartup) void this.refreshTools(generation);
    } catch (error) {
      if (transport) await transport.close().catch(() => undefined);
      if (generation === this.generation) {
        this.transport = undefined;
        this.publish({ state: "error", tools: [], error: errorMessage(error), pid: undefined });
      }
      throw error instanceof Error ? error : new McpClientError(errorMessage(error));
    }
  }

  private async discoverTools(
    transport: McpTransport,
    options: McpRequestOptions = {},
  ): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    const names = new Set<string>();
    const cursors = new Set<string>();
    let pageCount = 0;
    let cursor: string | undefined;
    do {
      pageCount += 1;
      if (pageCount > MAX_MCP_DISCOVERY_PAGES) {
        throw new McpProtocolError("MCP tool discovery exceeded the page limit");
      }
      const page = parseListToolsResult(
        await transport.request("tools/list", cursor ? { cursor } : {}, options),
      );
      for (const tool of page.tools) {
        if (names.has(tool.name))
          throw new McpProtocolError(`Duplicate MCP tool name: ${tool.name}`);
        if (
          new TextEncoder().encode(JSON.stringify(tool.inputSchema)).byteLength >
          MAX_MCP_SCHEMA_BYTES
        ) {
          throw new McpProtocolError(`MCP input schema exceeds the size limit: ${tool.name}`);
        }
        if (
          tool.outputSchema &&
          new TextEncoder().encode(JSON.stringify(tool.outputSchema)).byteLength >
            MAX_MCP_SCHEMA_BYTES
        ) {
          throw new McpProtocolError(`MCP output schema exceeds the size limit: ${tool.name}`);
        }
        names.add(tool.name);
        tools.push(tool);
        if (tools.length > MAX_MCP_TOOL_COUNT) {
          throw new McpProtocolError("MCP tool discovery exceeded the tool limit");
        }
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) {
        throw new McpProtocolError("MCP tool discovery repeated a cursor");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }

  private async refreshTools(generation: number): Promise<void> {
    const transport = this.transport;
    if (!transport || generation !== this.generation) return;
    try {
      const tools = await this.discoverTools(transport);
      if (generation === this.generation) this.publish({ tools });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: errorMessage(error) });
    }
  }

  listTools(): Promise<McpTool[]> {
    return Promise.resolve([...this.snapshot.tools]);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<McpCallToolResult> {
    if (!this.transport || this.snapshot.state !== "ready") {
      throw new McpClientError("MCP client is not ready");
    }
    try {
      return parseCallToolResult(
        await this.transport.request("tools/call", { name, arguments: args }, options),
      );
    } catch (error) {
      const isCancellation = error instanceof DOMException && error.name === "AbortError";
      const isToolError = error instanceof McpProtocolError && error.code !== undefined;
      if (!isCancellation && !isToolError) this.failConnection(errorMessage(error));
      throw error;
    }
  }

  private failConnection(message: string): void {
    const transport = this.transport;
    if (!transport) return;
    this.transport = undefined;
    this.publish({ state: "error", tools: [], error: message, pid: undefined });
    void transport.close().catch(() => undefined);
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    if (!transport && this.snapshot.state === "disconnected") return;
    ++this.generation;
    this.publish({ state: "stopping" });
    this.notificationDisposer?.();
    this.notificationDisposer = undefined;
    this.transport = undefined;
    if (transport) await transport.close();
    this.publish({
      state: "disconnected",
      tools: [],
      serverInfo: undefined,
      capabilities: undefined,
      protocolVersion: undefined,
      pid: undefined,
      error: undefined,
    });
  }
}
