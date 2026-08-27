import { create } from "zustand";
// NOTE: Uses Dexie directly for mcp_servers; StoragePort covers basic CRUD
import type { McpServerRecord } from "../../core/storage/db";
import type { McpServerConfig, StdioMcpServer, HttpMcpServer } from "../../core/mcp/types";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { getRuntime } from "../../runtime/use-runtime";
import type { McpServerRuntimeSnapshot } from "../../core/mcp/runtime-service";
import { publicMcpToolId } from "../../core/mcp/tool-adapter";
import type { ToolResult } from "../../core/providers/tool-registry";
import { logger } from "../../core/logging/logger";

export type McpServerEntry = (StdioMcpServer | HttpMcpServer) & {
  createdAt: number;
  updatedAt: number;
};

export interface McpConnectionTestResult {
  testedAt: number;
  success: boolean;
  toolCount?: number;
  protocolVersion?: string;
  serverName?: string;
  error?: string;
}

interface McpState {
  servers: McpServerEntry[];
  runtimeSnapshots: Record<string, McpServerRuntimeSnapshot>;
  connectionTests: Record<string, McpConnectionTestResult>;
  loadServers: () => Promise<void>;
  addServer: (
    config: Omit<StdioMcpServer, "id" | "enabled"> | Omit<HttpMcpServer, "id" | "enabled">,
  ) => Promise<string>;
  removeServer: (id: string) => Promise<void>;
  toggleServer: (id: string) => Promise<void>;
  restartServer: (id: string) => Promise<void>;
  testServer: (id: string) => Promise<void>;
  executeApprovedTestTool: (
    serverId: string,
    rawToolName: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
  updateServer: (id: string, config: Partial<Omit<McpServerConfig, "id">>) => Promise<void>;
}

let runtimeSubscribed = false;

async function getMcpRuntime() {
  const factory = getRuntime().getMcpRuntime;
  if (!factory) return undefined;
  const runtime = await factory();
  if (!runtimeSubscribed) {
    runtimeSubscribed = true;
    runtime.subscribe((snapshot) => {
      const previous = useMcpStore.getState().runtimeSnapshots[snapshot.serverId];
      if (previous?.state !== snapshot.state || previous.tools.length !== snapshot.tools.length) {
        logger.info("mcp", "mcp.runtime-state-changed", {
          serverId: snapshot.serverId,
          previousState: previous?.state ?? "uninitialized",
          state: snapshot.state,
          toolCount: snapshot.tools.length,
        });
      }
      useMcpStore.setState((state) => ({
        runtimeSnapshots: { ...state.runtimeSnapshots, [snapshot.serverId]: snapshot },
      }));
    });
  }
  return runtime;
}

function recordRuntimeError(serverId: string, error: unknown): void {
  useMcpStore.setState((state) => ({
    runtimeSnapshots: {
      ...state.runtimeSnapshots,
      [serverId]: {
        serverId,
        state: "error",
        tools: [],
        error: error instanceof Error ? error.message : "MCP operation failed",
      },
    },
  }));
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function toRecord(entry: McpServerEntry): McpServerRecord {
  const { id, name, transport, enabled, createdAt, updatedAt, ...rest } = entry;
  return {
    id,
    name,
    transport,
    enabled: enabled ? 1 : 0,
    config: JSON.stringify(rest),
    createdAt,
    updatedAt,
  };
}

function toEntry(record: McpServerRecord): McpServerEntry {
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(record.config) as Record<string, unknown>;
  } catch {
    // Corrupted config — treat as empty
  }
  return {
    id: record.id,
    name: record.name,
    transport: record.transport,
    enabled: record.enabled === 1,
    ...extra,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as McpServerEntry;
}

export const useMcpStore = create<McpState>((set) => ({
  servers: [],
  runtimeSnapshots: {},
  connectionTests: {},

  loadServers: async () => {
    const startedAt = Date.now();
    await getMcpRuntime();
    const records = await getStructuredStorage().readAll<McpServerRecord>("mcp_servers");
    records.sort((a, b) => b.createdAt - a.createdAt);
    set({ servers: records.map(toEntry) });
    logger.debug("mcp", "mcp.catalog-loaded", {
      serverCount: records.length,
      enabledCount: records.filter(({ enabled }) => enabled === 1).length,
      durationMs: Date.now() - startedAt,
    });
  },

  addServer: async (config) => {
    const now = Date.now();
    const entry: McpServerEntry = {
      ...config,
      id: crypto.randomUUID(),
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };

    await getStructuredStorage().write("mcp_servers", entry.id, toRecord(entry));
    set(({ servers }) => ({ servers: [entry, ...servers] }));
    logger.info("mcp", "mcp.server-added", {
      serverId: entry.id,
      transport: entry.transport,
    });
    return entry.id;
  },

  removeServer: async (id) => {
    const startedAt = Date.now();
    const server = useMcpStore.getState().servers.find((entry) => entry.id === id);
    await (await getMcpRuntime())?.disable(id);
    await getStructuredStorage().delete("mcp_servers", id);
    set(({ servers, runtimeSnapshots, connectionTests }) => {
      const nextSnapshots = { ...runtimeSnapshots };
      const nextTests = { ...connectionTests };
      delete nextSnapshots[id];
      delete nextTests[id];
      return {
        servers: servers.filter((s) => s.id !== id),
        runtimeSnapshots: nextSnapshots,
        connectionTests: nextTests,
      };
    });
    logger.info("mcp", "mcp.server-removed", {
      serverId: id,
      transport: server?.transport ?? "unknown",
      durationMs: Date.now() - startedAt,
    });
  },

  toggleServer: async (id) => {
    const { servers } = useMcpStore.getState();
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    const startedAt = Date.now();
    const updated = { ...server, enabled: !server.enabled };
    const action = updated.enabled ? "enable" : "disable";
    logger.info("mcp", "mcp.server-toggle-started", {
      serverId: id,
      transport: server.transport,
      action,
    });
    await getStructuredStorage().write("mcp_servers", id, toRecord(updated));
    set(({ connectionTests }) => {
      const nextTests = { ...connectionTests };
      delete nextTests[id];
      return {
        servers: servers.map((s) => (s.id === id ? updated : s)),
        connectionTests: nextTests,
      };
    });
    try {
      const runtime = await getMcpRuntime();
      if (updated.enabled) await runtime?.enable(updated);
      else await runtime?.disable(id);
      const snapshot = runtime?.getSnapshot(id);
      logger.info("mcp", "mcp.server-toggle-completed", {
        serverId: id,
        transport: server.transport,
        action,
        runtimeAvailable: Boolean(runtime),
        state: snapshot?.state ?? (updated.enabled ? "unavailable" : "disabled"),
        toolCount: snapshot?.tools.length ?? 0,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      recordRuntimeError(id, error);
      logger.error("mcp", "mcp.server-toggle-failed", {
        serverId: id,
        transport: server.transport,
        action,
        errorType: errorType(error),
        durationMs: Date.now() - startedAt,
      });
    }
  },

  restartServer: async (id) => {
    const server = useMcpStore.getState().servers.find((entry) => entry.id === id);
    if (!server?.enabled) return;
    const startedAt = Date.now();
    logger.info("mcp", "mcp.server-restart-started", {
      serverId: id,
      transport: server.transport,
    });
    try {
      const snapshot = await (await getMcpRuntime())?.restart(server);
      logger.info("mcp", "mcp.server-restart-completed", {
        serverId: id,
        transport: server.transport,
        state: snapshot?.state ?? "unavailable",
        toolCount: snapshot?.tools.length ?? 0,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      recordRuntimeError(id, error);
      logger.error("mcp", "mcp.server-restart-failed", {
        serverId: id,
        transport: server.transport,
        errorType: errorType(error),
        durationMs: Date.now() - startedAt,
      });
    }
  },

  testServer: async (id) => {
    const server = useMcpStore.getState().servers.find((entry) => entry.id === id);
    if (!server) return;
    const startedAt = Date.now();
    logger.info("mcp", "mcp.connection-test-started", {
      serverId: id,
      transport: server.transport,
    });
    try {
      const snapshot = await (await getMcpRuntime())?.test(server);
      if (!snapshot) throw new Error("MCP runtime unavailable");
      set(({ connectionTests }) => ({
        connectionTests: {
          ...connectionTests,
          [id]: {
            testedAt: Date.now(),
            success: true,
            toolCount: snapshot.tools.length,
            ...(snapshot.protocolVersion ? { protocolVersion: snapshot.protocolVersion } : {}),
            ...(snapshot.serverInfo?.name ? { serverName: snapshot.serverInfo.name } : {}),
          },
        },
      }));
      logger.info("mcp", "mcp.connection-test-completed", {
        serverId: id,
        transport: server.transport,
        state: snapshot.state,
        toolCount: snapshot.tools.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      set(({ connectionTests }) => ({
        connectionTests: {
          ...connectionTests,
          [id]: {
            testedAt: Date.now(),
            success: false,
            error: error instanceof Error ? error.message : "MCP connection test failed",
          },
        },
      }));
      logger.error("mcp", "mcp.connection-test-failed", {
        serverId: id,
        transport: server.transport,
        errorType: errorType(error),
        durationMs: Date.now() - startedAt,
      });
    }
  },

  executeApprovedTestTool: async (serverId, rawToolName, args) => {
    const { runtimeSnapshots } = useMcpStore.getState();
    const snapshot = runtimeSnapshots[serverId];
    if (snapshot?.state !== "ready" || !snapshot.tools.some((tool) => tool.name === rawToolName)) {
      return { success: false, output: "MCP tool is not ready", error: "tool_not_ready" };
    }
    const runtime = getRuntime();
    if (!runtime.toolExecutor) {
      return { success: false, output: "Tool executor unavailable", error: "unavailable" };
    }
    return runtime.toolExecutor.execute(
      publicMcpToolId(serverId, rawToolName),
      args,
      runtime,
      true,
    );
  },

  updateServer: async (id, config) => {
    const { servers } = useMcpStore.getState();
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    const now = Date.now();
    const updated = { ...server, ...config, updatedAt: now } as McpServerEntry;
    await getStructuredStorage().write("mcp_servers", id, {
      ...toRecord(updated),
      updatedAt: now,
    });
    logger.info("mcp", "mcp.server-updated", {
      serverId: id,
      transport: updated.transport,
      enabled: updated.enabled,
    });
    set(({ connectionTests }) => {
      const nextTests = { ...connectionTests };
      delete nextTests[id];
      return {
        servers: servers.map((s) => (s.id === id ? updated : s)),
        connectionTests: nextTests,
      };
    });
    if (updated.enabled) {
      try {
        await (await getMcpRuntime())?.restart(updated);
      } catch (error) {
        recordRuntimeError(id, error);
      }
    }
  },
}));
