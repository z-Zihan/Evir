import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentRuntime } from "../../components/component-runtime";
import { createToolRegistry } from "../../tools/tool-registry-impl";
import { ToolExecutor } from "../../tools/tool-executor";
import type { EvirRuntime } from "../../../runtime/types";
import { McpClient } from "../mcp-client";
import { McpRuntimeService } from "../runtime-service";
import type { McpServerConfig, McpTool } from "../types";
import type { McpTransport } from "../transports";

class RuntimeFixtureTransport implements McpTransport {
  closed = false;
  closeGate: Promise<void> | undefined;
  tools: McpTool[] = [
    {
      name: "dangerous.write",
      description: "External description",
      inputSchema: { type: "object" },
    },
  ];
  private listeners = new Set<(method: string, params?: Record<string, unknown>) => void>();

  request(method: string): Promise<unknown> {
    if (method === "initialize") {
      return Promise.resolve({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture" },
      });
    }
    if (method === "tools/list") {
      return Promise.resolve({ tools: this.tools });
    }
    if (method === "tools/call") {
      return Promise.resolve({ content: [{ type: "text", text: "fixture result" }] });
    }
    return Promise.reject(new Error(`Unexpected method: ${method}`));
  }

  notify(): Promise<void> {
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

  async close(): Promise<void> {
    await this.closeGate;
    this.closed = true;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const server: McpServerConfig = {
  id: "fixture-server",
  name: "Fixture server",
  transport: "stdio",
  command: "fixture",
  args: [],
  envSecretRefs: {},
  enabled: true,
};

function setup() {
  const registry = createToolRegistry();
  const components = new ComponentRuntime({
    target: "desktop",
    toolRegistry: registry,
    hostDependencies: ["capability:localMcp"],
  });
  const transports: RuntimeFixtureTransport[] = [];
  const service = new McpRuntimeService(components, {}, () => {
    const transport = new RuntimeFixtureTransport();
    transports.push(transport);
    return new McpClient({ openTransport: () => Promise.resolve(transport) });
  });
  return { registry, components, service, transports };
}

describe("McpRuntimeService", () => {
  afterEach(() => vi.useRealTimers());

  it("publishes MCP tools through ComponentRuntime and removes them on disable", async () => {
    const { registry, service, transports } = setup();

    const snapshot = await service.enable(server);

    expect(snapshot.state).toBe("ready");
    expect(registry.list()[0]?.name).toMatch(/^mcp__fixture-server__dangerous_write_[0-9a-f]{8}$/);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        source: "mcp-local",
        riskLevel: "L3",
        requiredCapability: "localMcp",
      }),
    ]);

    await service.disable(server.id);

    expect(registry.list()).toEqual([]);
    expect(transports[0]?.closed).toBe(true);
  });

  it("keeps existing mode, capability, and approval enforcement authoritative", async () => {
    const { registry, service } = setup();
    await service.enable(server);
    const executor = new ToolExecutor(registry);
    const runtime: EvirRuntime = {
      target: "desktop",
      capabilities: new Set(["localMcp"]),
      has: (capability) => capability === "localMcp",
      mode: "agent",
    };
    const toolId = registry.list()[0]?.id;
    expect(toolId).toBeDefined();

    await expect(executor.execute(toolId!, {}, runtime)).resolves.toMatchObject({
      success: false,
      error: "permission_required",
    });
    await expect(executor.execute(toolId!, {}, runtime, true)).resolves.toEqual({
      success: true,
      output: "fixture result",
    });

    runtime.mode = "plan";
    await expect(executor.execute(toolId!, {}, runtime, true)).resolves.toMatchObject({
      success: false,
      error: "tool_not_allowed",
    });
  });

  it("tests a connection without publishing its tools", async () => {
    const { registry, service, transports } = setup();

    const snapshot = await service.test(server);

    expect(snapshot.state).toBe("ready");
    expect(snapshot.tools).toHaveLength(1);
    expect(registry.list()).toEqual([]);
    expect(transports[0]?.closed).toBe(true);
  });

  it("replaces a failed process generation after bounded backoff", async () => {
    vi.useFakeTimers();
    const { registry, service, transports } = setup();
    await service.enable(server);

    transports[0]?.emit("evir/process_exited");

    expect(service.getSnapshot(server.id)?.state).toBe("reconnecting");
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.list()).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(service.getSnapshot(server.id)?.state).toBe("ready"));
    expect(transports).toHaveLength(2);
    expect(transports[0]?.closed).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it("does not overlap process generations while restarting", async () => {
    const { service, transports } = setup();
    await service.enable(server);
    const closing = deferred<void>();
    transports[0]!.closeGate = closing.promise;

    const restarting = service.restart(server);
    await Promise.resolve();
    await Promise.resolve();

    expect(transports).toHaveLength(1);
    closing.resolve(undefined);
    await restarting;
    expect(transports).toHaveLength(2);
    expect(transports[0]?.closed).toBe(true);
  });

  it("keeps an unchanged live configuration idempotent", async () => {
    const { service, transports } = setup();

    const first = await service.enable(server);
    const second = await service.enable(server);

    expect(second).toBe(first);
    expect(transports).toHaveLength(1);
  });

  it("rejects an invalid restart before tearing down the live generation", async () => {
    const { registry, service, transports } = setup();
    await service.enable(server);

    await expect(service.restart({ ...server, command: "" })).rejects.toThrow(
      "configuration is invalid",
    );

    expect(transports).toHaveLength(1);
    expect(transports[0]?.closed).toBe(false);
    expect(registry.list()).toHaveLength(1);
  });

  it("keeps the previous tool generation when a replacement conflicts", async () => {
    const { registry, service, transports } = setup();
    await service.enable(server);
    registry.register({
      id: "mcp__fixture-server__foreign",
      name: "mcp__fixture-server__foreign",
      description: "Foreign registration",
      source: "evir-local",
      riskLevel: "L0",
      schema: { type: "object" },
      execute: () => Promise.resolve({ success: true, output: "foreign" }),
    });
    transports[0]!.tools = [{ name: "foreign", inputSchema: { type: "object" } }];

    transports[0]!.emit("notifications/tools/list_changed");

    await vi.waitFor(() => expect(service.getSnapshot(server.id)?.state).toBe("error"));
    expect(registry.list().map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^mcp__fixture-server__dangerous_write_/),
        "mcp__fixture-server__foreign",
      ]),
    );
  });
});
