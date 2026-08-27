import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../../core/storage/db";
import { logger } from "../../../core/logging/logger";
import { useMcpStore } from "../mcp-store";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  logger.clear();
  useMcpStore.setState({ servers: [], runtimeSnapshots: {}, connectionTests: {} });
});

describe("mcp-store", () => {
  it("starts with empty servers", () => {
    expect(useMcpStore.getState().servers).toHaveLength(0);
  });

  it("addServer creates with enabled=false", async () => {
    const id = await useMcpStore.getState().addServer({
      name: "Filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      envSecretRefs: {},
    });
    const { servers } = useMcpStore.getState();
    expect(servers).toHaveLength(1);
    expect(servers[0]?.id).toBe(id);
    expect(servers[0]?.enabled).toBe(false);
    expect(servers[0]?.name).toBe("Filesystem");
    expect(logger.getEntries().at(-1)).toMatchObject({
      channel: "mcp",
      event: "mcp.server-added",
      data: { serverId: id, transport: "stdio" },
    });
    expect(logger.exportLogs()).not.toContain("@modelcontextprotocol/server-filesystem");
  });

  it("toggleServer flips enabled state", async () => {
    const id = await useMcpStore.getState().addServer({
      name: "Test",
      transport: "streamable-http",
      url: "https://example.com/mcp",
      headerSecretRefs: {},
    });
    await useMcpStore.getState().toggleServer(id);
    expect(useMcpStore.getState().servers[0]?.enabled).toBe(true);
    await useMcpStore.getState().toggleServer(id);
    expect(useMcpStore.getState().servers[0]?.enabled).toBe(false);
    expect(logger.getEntries().map(({ event }) => event)).toEqual(
      expect.arrayContaining(["mcp.server-toggle-started", "mcp.server-toggle-completed"]),
    );
    expect(logger.exportLogs()).not.toContain("https://example.com/mcp");
  });

  it("removeServer deletes from store and DB", async () => {
    const id = await useMcpStore.getState().addServer({
      name: "Test",
      transport: "stdio",
      command: "npx",
      args: [],
      envSecretRefs: {},
    });
    await useMcpStore.getState().removeServer(id);
    expect(useMcpStore.getState().servers).toHaveLength(0);
    expect(await db.mcpServers.count()).toBe(0);
  });

  it("loadServers restores from DB", async () => {
    await useMcpStore.getState().addServer({
      name: "Server A",
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-a"],
      envSecretRefs: {},
    });
    await useMcpStore.getState().addServer({
      name: "Server B",
      transport: "streamable-http",
      url: "https://b.example.com/mcp",
      headerSecretRefs: {},
    });
    useMcpStore.setState({ servers: [] });
    await useMcpStore.getState().loadServers();
    expect(useMcpStore.getState().servers).toHaveLength(2);
    expect(useMcpStore.getState().servers.map((s) => s.name)).toEqual(
      expect.arrayContaining(["Server A", "Server B"]),
    );
    expect(logger.getEntries().at(-1)).toMatchObject({
      channel: "mcp",
      event: "mcp.catalog-loaded",
      data: { serverCount: 2, enabledCount: 0 },
    });
  });
});
