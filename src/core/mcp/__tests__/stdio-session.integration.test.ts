// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ComponentRuntime } from "../../components/component-runtime";
import { createToolRegistry } from "../../tools/tool-registry-impl";
import { ToolExecutor } from "../../tools/tool-executor";
import type { EvirRuntime } from "../../../runtime/types";
import { McpRuntimeService } from "../runtime-service";
import type { McpServerConfig } from "../types";
import { logger } from "../../logging/logger";
import { McpClient } from "../mcp-client";
import { StdioMcpTransport } from "../transports";

/**
 * MCP-1 in-session evidence with a REAL stdio subprocess: the fixture server
 * (fixture-stdio-server.mjs) runs as a node child behind a Rust-invoke double
 * that speaks the same mcp_stdio_* command surface. Journey: enable → tools
 * listed in the Tool Registry → unapproved call blocked (permission_required)
 * → approved call returns the fixture result → trace events exist → Stop
 * (abort) cancels an in-flight call.
 */

const FIXTURE = fileURLToPath(new URL("./fixture-stdio-server.mjs", import.meta.url));

class SubprocessHost {
  child: ChildProcess | null = null;
  pid = 0;
  startedAt = 0;
  stoppedAt = 0;
  requestCount = 0;

  start(): void {
    this.child = spawn(process.execPath, [FIXTURE], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, EVIR_TEST_SECRET: "super-secret-value-do-not-log" },
    });
    this.pid = this.child.pid ?? 0;
    this.startedAt = Date.now();
  }

  write(message: unknown): void {
    if (!this.child?.stdin) throw new Error("fixture stdin closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Resolve one JSON-RPC response for the given id from the fixture. */
  waitFor(id: number, timeoutMs = 5_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdout) {
        reject(new Error("fixture stdout closed"));
        return;
      }
      let buffer = "";
      const timer = setTimeout(() => {
        this.child?.stdout?.off("data", onChunk);
        reject(new Error(`fixture response ${id} timed out`));
      }, timeoutMs);
      const onChunk = (chunk: Buffer): void => {
        buffer += chunk.toString("utf8");
        for (const line of buffer.split("\n")) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as { id?: number };
            if (message.id === id) {
              clearTimeout(timer);
              this.child?.stdout?.off("data", onChunk);
              resolve(message);
              return;
            }
          } catch {
            // partial line; keep buffering
          }
        }
        buffer = buffer.split("\n").pop() ?? "";
      };
      this.child.stdout.on("data", onChunk);
    });
  }

  stop(): void {
    this.child?.kill("SIGTERM");
    this.child = null;
    this.stoppedAt = Date.now();
  }
}

describe("MCP in-session tools over a real stdio subprocess (MCP-1)", () => {
  let host: SubprocessHost;
  let registry: ReturnType<typeof createToolRegistry>;
  let components: ComponentRuntime;
  let service: McpRuntimeService;
  let server: McpServerConfig;

  const auditEvents: Array<{
    channel: string;
    event: string;
    data: Record<string, unknown> | undefined;
  }> = [];

  const desktopRuntime = (): EvirRuntime => ({
    target: "desktop",
    capabilities: new Set(["localMcp"]),
    has: (capability: string) => capability === "localMcp",
    mode: "agent",
  });

  beforeAll(() => {
    host = new SubprocessHost();
    const invokeDouble = async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "mcp_stdio_start":
          host.start();
          return { pid: host.pid };
        case "mcp_stdio_stop":
          host.stop();
          return { stopped: true };
        case "mcp_stdio_request": {
          host.requestCount += 1;
          const request = args.request as { id: number };
          const pending = host.waitFor(request.id);
          host.write(request);
          const response = await pending;
          return response;
        }
        case "mcp_stdio_send":
          host.write(args.message);
          return { sent: true };
        case "vault_resolve_secret":
          return { value: "super-secret-value-do-not-log" };
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    };
    const listenDouble = () => Promise.resolve(() => undefined);

    registry = createToolRegistry();
    components = new ComponentRuntime({
      target: "desktop",
      toolRegistry: registry,
      hostDependencies: ["capability:localMcp"],
    });
    // Trace evidence: record executor events at debug level.
    const originalDebug = logger.debug.bind(logger);
    const recordDebug = (
      channel: Parameters<typeof originalDebug>[0],
      event: string,
      data?: Record<string, unknown>,
    ): void => {
      auditEvents.push({ channel, event, data });
      originalDebug(channel, event, data);
    };
    logger.debug = recordDebug;

    service = new McpRuntimeService(
      components,
      {},
      () =>
        new McpClient({
          openTransport: () =>
            StdioMcpTransport.open(
              server as Extract<McpServerConfig, { transport: "stdio" }>,
              invokeDouble as Parameters<typeof StdioMcpTransport.open>[1],
              listenDouble,
            ),
        }),
    );

    server = {
      id: "fixture-stdio",
      name: "Fixture stdio",
      transport: "stdio",
      enabled: true,
      command: process.execPath,
      args: [FIXTURE],
      envSecretRefs: {},
    };
  });

  afterAll(() => {
    host.stop();
    void service.dispose();
  });

  it("enable → tool listed → unapproved call blocked → approved call returns the result", async () => {
    const snapshot = await service.enable(server);
    expect(snapshot.state).toBe("ready");

    // Tool Registry carries the fixture tool with L3 + capability + approval.
    const tools = registry.list();
    expect(tools).toHaveLength(1);
    const fixtureTool = tools[0] as {
      source: string;
      riskLevel: string;
      requiredCapability: string;
    };
    expect(fixtureTool).toEqual(
      expect.objectContaining({
        source: "mcp-local",
        riskLevel: "L3",
        requiredCapability: "localMcp",
      }),
    );

    const runtime: EvirRuntime = desktopRuntime();
    const executor = new ToolExecutor(registry);
    const toolId = tools[0]!.id;
    const args = { text: "hello session" };

    // Unapproved: the approval conversation (permission_required).
    const blocked = await executor.execute(toolId, args, runtime);
    expect(blocked).toMatchObject({ success: false, error: "permission_required" });

    // Approved: REAL subprocess round-trip with the fixture result.
    const approved = await executor.execute(toolId, args, runtime, true);
    expect(approved).toMatchObject({ success: true });
    expect(approved.output).toContain("fixture echo: hello session");

    // Trace evidence: the executor records the call; the blocked call carries
    // the structured permission_required code (the approval conversation the
    // agent-loop turns into the approval card).
    expect(auditEvents.some(({ event }) => event === "executor.execute")).toBe(true);
    expect(blocked).toMatchObject({ error: "permission_required" });

    // The Web surface never sees the tool (capability gate).
    const webRuntime = {
      target: "web" as const,
      capabilities: new Set<string>(),
      has: () => false,
      mode: "agent" as const,
    } as unknown as EvirRuntime;
    const webBlocked = await executor.execute(toolId, args, webRuntime, true);
    expect(webBlocked).toMatchObject({ error: "capability_not_available" });
  });

  it("Stop cancels an in-flight MCP call (abort signal closes the transport)", async () => {
    const tools = registry.list();
    const toolId = tools[0]?.id;
    expect(toolId).toBeDefined();
    const executor = new ToolExecutor(registry);
    const runtime = desktopRuntime();

    const controller = new AbortController();
    const pending = executor.execute(
      toolId!,
      { text: "to be cancelled" },
      runtime,
      true,
      controller.signal,
    );
    controller.abort();
    const result = await pending;
    // Aborted (or transport-closed) — either honest failure is acceptable;
    // a silent success with stale content is not.
    expect(result.success).toBe(false);

    // Re-enable for any later assertions: the service replaces the closed
    // process generation.
    const snapshot = await service.enable(server);
    expect(snapshot.state).toBe("ready");
  });
});
