import type {
  ComponentActivationContext,
  ComponentConfigurationMap,
  ComponentDefinition,
  ComponentRuntimePort,
} from "../components/types";
import { McpClient, type McpClientSnapshot } from "./mcp-client";
import { parseMcpServerConfig, type McpServerRepository } from "./mcp-repository";
import { McpToolPublisher } from "./tool-adapter";
import type { McpServerConfig } from "./types";

const RECONNECT_INITIAL_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 5;

export interface McpServerRuntimeSnapshot extends McpClientSnapshot {
  serverId: string;
}

export interface McpRuntimePort {
  enable(server: McpServerConfig): Promise<McpServerRuntimeSnapshot>;
  test(server: McpServerConfig): Promise<McpServerRuntimeSnapshot>;
  disable(serverId: string): Promise<void>;
  restart(server: McpServerConfig): Promise<McpServerRuntimeSnapshot>;
  activatePersisted(): Promise<void>;
  getSnapshot(serverId: string): McpServerRuntimeSnapshot | undefined;
  subscribe(listener: (snapshot: McpServerRuntimeSnapshot) => void): () => void;
  dispose(): Promise<void>;
}

interface ServerRuntime {
  server: McpServerConfig;
  client: McpClient;
  publisher: McpToolPublisher;
  ready: Promise<void>;
  unsubscribe: () => void;
}

function componentId(serverId: string): string {
  const safe = serverId
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/^-+|-+$/g, "");
  let hash = 0;
  for (const char of serverId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `mcp.server.${safe || "server"}.${hash.toString(16)}`;
}

function asSnapshot(serverId: string, snapshot: McpClientSnapshot): McpServerRuntimeSnapshot {
  return { serverId, ...snapshot };
}

export class McpRuntimeService implements McpRuntimePort {
  private readonly definitions = new Set<string>();
  private readonly configuration: Record<string, { enabled: boolean; config?: unknown }>;
  private readonly servers = new Map<string, ServerRuntime>();
  private readonly snapshots = new Map<string, McpServerRuntimeSnapshot>();
  private readonly listeners = new Set<(snapshot: McpServerRuntimeSnapshot) => void>();
  private readonly desired = new Map<string, McpServerConfig>();
  private readonly reconnects = new Map<
    string,
    { attempt: number; timer?: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly componentRuntime: ComponentRuntimePort,
    initialConfiguration: ComponentConfigurationMap = {},
    private readonly createClient: () => McpClient = () => new McpClient(),
    private readonly repository?: McpServerRepository,
  ) {
    this.configuration = { ...initialConfiguration };
  }

  subscribe(listener: (snapshot: McpServerRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(serverId: string): McpServerRuntimeSnapshot | undefined {
    return this.snapshots.get(serverId);
  }

  private publish(serverId: string, snapshot: McpClientSnapshot): void {
    const previous = this.snapshots.get(serverId);
    const value = asSnapshot(serverId, {
      ...snapshot,
      ...(snapshot.lastReadyAt === undefined && previous?.lastReadyAt !== undefined
        ? { lastReadyAt: previous.lastReadyAt }
        : {}),
    });
    this.snapshots.set(serverId, value);
    for (const listener of this.listeners) listener(value);
  }

  private definition(server: McpServerConfig): ComponentDefinition<McpServerConfig> {
    const id = componentId(server.id);
    return {
      manifest: {
        id,
        version: "1.0.0",
        kind: "infrastructure",
        targets: ["desktop"],
        provides: [`mcp-server:${server.id}`],
        requires: ["capability:localMcp"],
        defaultEnabled: false,
        trust: "builtin",
      },
      parseConfig: () => server,
      activate: (context, config) => this.activateServer(context, config),
    };
  }

  private activateServer(context: ComponentActivationContext, server: McpServerConfig): () => void {
    const client = this.createClient();
    const publisher = new McpToolPublisher(context, server, client);
    const unsubscribe = client.subscribe((snapshot) => {
      this.publish(server.id, snapshot);
      if (snapshot.state === "ready") {
        void publisher.replace(snapshot.tools).catch((error: unknown) => {
          this.publish(server.id, {
            ...snapshot,
            state: "error",
            tools: [],
            error: error instanceof Error ? error.message : "MCP tool registration failed",
          });
        });
      } else if (snapshot.state === "error" || snapshot.state === "disconnected") {
        void publisher.clear();
        if (snapshot.state === "error") this.scheduleReconnect(server);
      }
    });
    const ready = client.connect(server).then(() => publisher.waitForIdle());
    this.servers.set(server.id, { server, client, publisher, ready, unsubscribe });
    return () => {
      unsubscribe();
      this.servers.delete(server.id);
      void publisher.clear();
      void client.disconnect();
    };
  }

  async enable(server: McpServerConfig): Promise<McpServerRuntimeSnapshot> {
    const validated = parseMcpServerConfig(server);
    const current = this.servers.get(validated.id);
    const currentState = this.snapshots.get(validated.id)?.state;
    if (
      current &&
      JSON.stringify(current.server) === JSON.stringify(validated) &&
      currentState !== "error" &&
      currentState !== "disconnected"
    ) {
      await current.ready;
      const snapshot = this.snapshots.get(validated.id);
      if (snapshot) return snapshot;
    }
    if (current) await this.deactivate(validated.id);
    this.desired.set(validated.id, validated);
    this.clearReconnect(validated.id);
    return this.activate(validated);
  }

  async test(server: McpServerConfig): Promise<McpServerRuntimeSnapshot> {
    const validated = parseMcpServerConfig(server);
    const active = this.snapshots.get(validated.id);
    if (active?.state === "ready") return active;
    const client = this.createClient();
    try {
      await client.connect(validated);
      return asSnapshot(validated.id, client.getSnapshot());
    } finally {
      await client.disconnect();
    }
  }

  private async activate(server: McpServerConfig): Promise<McpServerRuntimeSnapshot> {
    const id = componentId(server.id);
    const definition = this.definition(server);
    if (this.definitions.has(id)) this.componentRuntime.replace(definition);
    else {
      this.componentRuntime.register(definition);
      this.definitions.add(id);
    }
    this.configuration[id] = { enabled: true, config: server };
    this.componentRuntime.reconcile(this.configuration);
    const runtime = this.servers.get(server.id);
    if (!runtime) throw new Error(`MCP component did not activate: ${server.id}`);
    await runtime.ready;
    const snapshot = this.snapshots.get(server.id);
    if (!snapshot) throw new Error(`MCP server produced no runtime state: ${server.id}`);
    return snapshot;
  }

  async disable(serverId: string): Promise<void> {
    this.desired.delete(serverId);
    this.clearReconnect(serverId);
    await this.deactivate(serverId);
  }

  private async deactivate(serverId: string): Promise<void> {
    const id = componentId(serverId);
    const runtime = this.servers.get(serverId);
    if (runtime) {
      await runtime.client.disconnect();
      await runtime.publisher.clear();
    }
    this.configuration[id] = { enabled: false };
    this.componentRuntime.reconcile(this.configuration);
  }

  async restart(server: McpServerConfig): Promise<McpServerRuntimeSnapshot> {
    const validated = parseMcpServerConfig(server);
    await this.disable(validated.id);
    return this.enable(validated);
  }

  async activatePersisted(): Promise<void> {
    if (!this.repository) return;
    const servers = await this.repository.listEnabled();
    await Promise.allSettled(
      servers.map((server) => {
        const state = this.snapshots.get(server.id)?.state;
        return state === "ready" || state === "starting" || state === "initializing"
          ? Promise.resolve()
          : this.enable(server);
      }),
    );
  }

  private scheduleReconnect(server: McpServerConfig): void {
    if (!this.desired.has(server.id)) return;
    const previous = this.reconnects.get(server.id);
    if (previous?.timer || (previous?.attempt ?? 0) >= RECONNECT_MAX_ATTEMPTS) return;
    const attempt = (previous?.attempt ?? 0) + 1;
    const delay = Math.min(RECONNECT_INITIAL_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
    const current = this.snapshots.get(server.id);
    if (current) this.publish(server.id, { ...current, state: "reconnecting", tools: [] });
    const timer = globalThis.setTimeout(() => {
      this.reconnects.set(server.id, { attempt });
      void this.reconnect(server);
    }, delay);
    this.reconnects.set(server.id, { attempt, timer });
  }

  private async reconnect(server: McpServerConfig): Promise<void> {
    if (!this.desired.has(server.id)) return;
    try {
      await this.deactivate(server.id);
      await this.activate(server);
      this.clearReconnect(server.id);
    } catch {
      this.scheduleReconnect(server);
    }
  }

  private clearReconnect(serverId: string): void {
    const reconnect = this.reconnects.get(serverId);
    if (reconnect?.timer) globalThis.clearTimeout(reconnect.timer);
    this.reconnects.delete(serverId);
  }

  async dispose(): Promise<void> {
    for (const serverId of this.reconnects.keys()) this.clearReconnect(serverId);
    this.desired.clear();
    await Promise.all([...this.servers.keys()].map((serverId) => this.deactivate(serverId)));
    for (const id of this.definitions) this.configuration[id] = { enabled: false };
    this.componentRuntime.reconcile(this.configuration);
    this.snapshots.clear();
  }
}
