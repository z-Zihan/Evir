import { describe, expect, it, vi } from "vitest";
import { McpClient } from "../mcp-client";
import type { McpServerConfig, McpTool } from "../types";
import type { McpTransport } from "../transports";

const server: McpServerConfig = {
  id: "fixture",
  name: "Fixture",
  transport: "stdio",
  command: "fixture",
  args: [],
  envSecretRefs: {},
  enabled: true,
};

class FixtureTransport implements McpTransport {
  readonly pid = 4321;
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly notifications: string[] = [];
  closed = false;
  tools: McpTool[] = [
    {
      name: "read",
      description: "Read a value",
      inputSchema: { type: "object" },
    },
    {
      name: "write",
      inputSchema: { type: "object" },
    },
  ];
  private listeners = new Set<(method: string, params?: Record<string, unknown>) => void>();

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "initialize") {
      return Promise.resolve({
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "fixture", version: "1.0.0" },
      });
    }
    if (method === "tools/list") {
      if (params.cursor === "page-2") return Promise.resolve({ tools: this.tools.slice(1) });
      return Promise.resolve({
        tools: this.tools.slice(0, 1),
        ...(this.tools.length > 1 ? { nextCursor: "page-2" } : {}),
      });
    }
    if (method === "tools/call") {
      return Promise.resolve({ content: [{ type: "text", text: "called" }] });
    }
    throw new Error(`Unexpected method: ${method}`);
  }

  notify(method: string): Promise<void> {
    this.notifications.push(method);
    return Promise.resolve();
  }

  onNotification(listener: (method: string, params?: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(method: string): void {
    for (const listener of this.listeners) listener(method);
  }

  setProtocolVersion(): void {}

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

describe("McpClient", () => {
  it("initializes, sends the initialized notification, drains pagination, and calls tools", async () => {
    const transport = new FixtureTransport();
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });
    const states: string[] = [];
    client.onStateChange((state) => states.push(state));

    await client.connect(server);

    expect(states).toEqual(["starting", "initializing", "discovering", "ready"]);
    expect(transport.notifications).toEqual(["notifications/initialized"]);
    expect((await client.listTools()).map((tool) => tool.name)).toEqual(["read", "write"]);
    const readySnapshot = client.getSnapshot();
    expect(typeof readySnapshot.lastReadyAt).toBe("number");
    expect(readySnapshot).toMatchObject({
      state: "ready",
      pid: 4321,
      protocolVersion: "2025-06-18",
      serverInfo: { name: "fixture", version: "1.0.0" },
      capabilities: { tools: { listChanged: true } },
    });
    await expect(client.callTool("read", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "called" }],
    });
  });

  it("replaces the discovered generation after a list-changed notification", async () => {
    const transport = new FixtureTransport();
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });
    await client.connect(server);
    transport.tools = [{ name: "replacement", inputSchema: { type: "object" } }];

    transport.emit("notifications/tools/list_changed");

    await vi.waitFor(() =>
      expect(client.getSnapshot().tools.map((tool) => tool.name)).toEqual(["replacement"]),
    );
  });

  it("fails closed on duplicate tool names and closes the transport", async () => {
    const transport = new FixtureTransport();
    transport.tools = [
      { name: "duplicate", inputSchema: {} },
      { name: "duplicate", inputSchema: {} },
    ];
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });

    await expect(client.connect(server)).rejects.toThrow("Duplicate MCP tool name");

    expect(transport.closed).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ state: "error", tools: [] });
  });

  it("unregisters notification ownership and clears state on disconnect", async () => {
    const transport = new FixtureTransport();
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });
    await client.connect(server);

    await client.disconnect();

    expect(transport.closed).toBe(true);
    const disconnectedSnapshot = client.getSnapshot();
    expect(typeof disconnectedSnapshot.lastReadyAt).toBe("number");
    expect(disconnectedSnapshot).toEqual({
      state: "disconnected",
      tools: [],
      serverInfo: undefined,
      capabilities: undefined,
      protocolVersion: undefined,
      pid: undefined,
      lastReadyAt: disconnectedSnapshot.lastReadyAt,
      error: undefined,
    });
  });

  it("rejects unsupported negotiated protocol versions", async () => {
    const transport = new FixtureTransport();
    const request = transport.request.bind(transport);
    transport.request = (method, params = {}) =>
      method === "initialize"
        ? Promise.resolve({
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "old" },
          })
        : request(method, params);
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });

    await expect(client.connect(server)).rejects.toThrow("Unsupported MCP protocol version");
    expect(transport.closed).toBe(true);
  });

  it("rejects repeated pagination cursors", async () => {
    const transport = new FixtureTransport();
    const request = transport.request.bind(transport);
    transport.request = (method, params = {}) =>
      method === "tools/list"
        ? Promise.resolve({ tools: [], nextCursor: "same-cursor" })
        : request(method, params);
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });

    await expect(client.connect(server)).rejects.toThrow("repeated a cursor");
    expect(transport.closed).toBe(true);
  });

  it("rejects oversized tool schemas before publication", async () => {
    const transport = new FixtureTransport();
    transport.tools = [
      {
        name: "oversized",
        inputSchema: { type: "object", description: "x".repeat(300_000) },
      },
    ];
    const client = new McpClient({ openTransport: () => Promise.resolve(transport) });

    await expect(client.connect(server)).rejects.toThrow("input schema exceeds the size limit");
    expect(client.getSnapshot().tools).toEqual([]);
  });
});
