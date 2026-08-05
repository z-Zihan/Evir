import { create } from "zustand";
// NOTE: Uses Dexie directly for mcp_servers; StoragePort covers basic CRUD
import { db, type McpServerRecord } from "../../core/storage/db";
import type { McpServerConfig, StdioMcpServer, HttpMcpServer } from "../../core/mcp/types";

export type McpServerEntry = (StdioMcpServer | HttpMcpServer) & {
  createdAt: number;
  updatedAt: number;
};

interface McpState {
  servers: McpServerEntry[];
  loadServers: () => Promise<void>;
  addServer: (
    config: Omit<StdioMcpServer, "id" | "enabled"> | Omit<HttpMcpServer, "id" | "enabled">,
  ) => Promise<string>;
  removeServer: (id: string) => Promise<void>;
  toggleServer: (id: string) => Promise<void>;
  updateServer: (id: string, config: Partial<Omit<McpServerConfig, "id">>) => Promise<void>;
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

  loadServers: async () => {
    const records = await db.mcpServers.toArray();
    records.sort((a, b) => b.createdAt - a.createdAt);
    set({ servers: records.map(toEntry) });
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

    await db.mcpServers.add(toRecord(entry));
    set(({ servers }) => ({ servers: [entry, ...servers] }));
    return entry.id;
  },

  removeServer: async (id) => {
    await db.mcpServers.delete(id);
    set(({ servers }) => ({ servers: servers.filter((s) => s.id !== id) }));
  },

  toggleServer: async (id) => {
    const { servers } = useMcpStore.getState();
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    const updated = { ...server, enabled: !server.enabled };
    await db.mcpServers.put(toRecord(updated));
    set({ servers: servers.map((s) => (s.id === id ? updated : s)) });
  },

  updateServer: async (id, config) => {
    const { servers } = useMcpStore.getState();
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    const now = Date.now();
    const updated = { ...server, ...config, updatedAt: now } as McpServerEntry;
    await db.mcpServers.put({ ...toRecord(updated), updatedAt: now });
    set({ servers: servers.map((s) => (s.id === id ? updated : s)) });
  },
}));
