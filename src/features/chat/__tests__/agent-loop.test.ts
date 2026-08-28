import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../../../core/providers/tool-registry";
import type { ProviderRecord } from "../../../core/storage/db";
import { ToolExecutor } from "../../../core/tools/tool-executor";
import { createToolRegistry } from "../../../core/tools/tool-registry-impl";
import type { EvirRuntime } from "../../../runtime/types";
import { MAX_AGENT_ITERATIONS, runAgentLoop } from "../agent-loop";
import { streamAssistant } from "../chat-stream";
import { HarnessMiddlewareRegistry } from "../../../core/harness/middleware-registry";
import {
  createLoopDetectionMiddleware,
  createProtectedToolPolicyMiddleware,
} from "../../../runtime/components/builtin-harness-components";

vi.mock("../chat-stream", () => ({ streamAssistant: vi.fn() }));

const provider: ProviderRecord = {
  id: "provider-1",
  name: "Provider",
  protocolId: "openai-chat-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "test-key",
  modelId: "model-1",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

function setupRuntime(execute: ToolDefinition["execute"]): EvirRuntime {
  const registry = createToolRegistry();
  registry.register({
    id: "read_file",
    name: "read_file",
    description: "Read a file",
    source: "evir-local",
    riskLevel: "L1",
    schema: { type: "object" },
    execute,
  });
  return {
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: (capability) => capability === "filesystem",
    toolRegistry: registry,
    toolExecutor: new ToolExecutor(registry),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("runAgentLoop", () => {
  it("executes tool calls and re-streams with tool results", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "file contents" }));
    vi.mocked(streamAssistant)
      .mockResolvedValueOnce({
        content: "",
        status: "complete",
        toolCalls: [{ id: "call-1", toolName: "read_file", arguments: '{"path":"/tmp/a"}' }],
      })
      .mockResolvedValueOnce({ content: "Finished", status: "complete" });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Read it" }],
      runtime: setupRuntime(execute),
      onDelta: vi.fn(),
    });

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.toolResults?.[0]).toMatchObject({
      success: true,
      output: "file contents",
    });
    expect(typeof result.turns[0]?.toolResults?.[0]?.startedAt).toBe("number");
    expect(typeof result.turns[0]?.toolResults?.[0]?.completedAt).toBe("number");
    expect(typeof result.turns[0]?.toolResults?.[0]?.durationMs).toBe("number");
    expect(execute).toHaveBeenCalledOnce();
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(streamAssistant).mock.calls[1]?.[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
        expect.objectContaining({ role: "tool", content: "file contents" }),
      ]),
    );
  });

  it("stops after the maximum tool-call iterations", async () => {
    vi.mocked(streamAssistant).mockResolvedValue({
      content: "",
      status: "complete",
      toolCalls: [{ id: "call-1", toolName: "read_file", arguments: "{}" }],
    });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Loop" }],
      runtime: setupRuntime(() => Promise.resolve({ success: true, output: "same" })),
      onDelta: vi.fn(),
    });

    expect(result.maxIterationsReached).toBe(true);
    expect(result.turns).toHaveLength(MAX_AGENT_ITERATIONS);
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
  });

  it("uses the component-provided loop detector to stop repeated calls", async () => {
    vi.mocked(streamAssistant).mockResolvedValue({
      content: "",
      status: "complete",
      toolCalls: [{ id: "call-1", toolName: "read_file", arguments: "{}" }],
    });
    const runtime = setupRuntime(() => Promise.resolve({ success: true, output: "same" }));
    const harnessMiddlewareRegistry = new HarnessMiddlewareRegistry();
    harnessMiddlewareRegistry.registerProtected(
      createProtectedToolPolicyMiddleware(),
      "evir.host.tool-policy",
    );
    harnessMiddlewareRegistry.register(
      createLoopDetectionMiddleware({
        warnRepeatedToolCalls: 1,
        stopRepeatedToolCalls: 2,
        stopUnchangedErrors: 2,
        stopFailedRetries: 2,
      }),
      "evir.harness.loop-detection",
    );

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Loop" }],
      runtime: { ...runtime, harnessMiddlewareRegistry },
      onDelta: vi.fn(),
    });

    expect(result.maxIterationsReached).toBe(true);
    expect(result.turns).toHaveLength(2);
    expect(result.turns.at(-1)?.stream.errorMessage).toBe("tools.maxIterations");
  });

  it("feeds step-scoped tool blocks back as tool results so the model can adapt", async () => {
    vi.mocked(streamAssistant)
      .mockResolvedValueOnce({
        content: "",
        status: "complete",
        toolCalls: [{ id: "call-1", toolName: "write_file", arguments: "{}" }],
      })
      .mockResolvedValueOnce({
        content: "Planned the change for the execute step",
        status: "complete",
      });
    // 只授予 read 工具，write_file 应被 tool-policy 以 tool-not-allowed 拦截
    const runtime = setupRuntime(() => Promise.resolve({ success: true, output: "ok" }));
    const readRuntime: EvirRuntime = {
      ...runtime,
      toolRegistry: (() => {
        const registry = createToolRegistry();
        registry.register({
          id: "read_file",
          name: "read_file",
          description: "Read",
          source: "evir-local",
          riskLevel: "L1",
          schema: { type: "object" },
          execute: () => Promise.resolve({ success: true, output: "" }),
        });
        return registry;
      })(),
    };
    const harnessMiddlewareRegistry = new HarnessMiddlewareRegistry();
    harnessMiddlewareRegistry.registerProtected(
      createProtectedToolPolicyMiddleware(),
      "evir.host.tool-policy",
    );

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Write it" }],
      runtime: { ...readRuntime, harnessMiddlewareRegistry },
      onDelta: vi.fn(),
    });

    // The denial is surfaced, the model gets a tool-result explanation, and the
    // loop continues instead of failing the whole node/run.
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.stream.content).toContain("Tool not allowed: write_file");
    expect(result.turns[0]?.toolResults?.[0]).toMatchObject({
      success: false,
      error: "tool_not_allowed",
    });
    expect(result.turns[1]?.stream.content).toBe("Planned the change for the execute step");
    expect(result.maxIterationsReached).toBe(false);
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(streamAssistant).mock.calls[1]?.[2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", tool_call_id: "call-1" })]),
    );
    const feedback = vi
      .mocked(streamAssistant)
      .mock.calls[1]?.[2].find((message) => message.role === "tool");
    expect(typeof feedback?.content).toBe("string");
    expect(String(feedback?.content)).toContain("Do not retry this tool");
  });

  it("blocks the run after repeated step-scoped denials", async () => {
    vi.mocked(streamAssistant).mockResolvedValue({
      content: "",
      status: "complete",
      toolCalls: [{ id: "call-denied", toolName: "write_file", arguments: "{}" }],
    });
    const runtime = setupRuntime(() => Promise.resolve({ success: true, output: "ok" }));
    const readRuntime: EvirRuntime = {
      ...runtime,
      toolRegistry: (() => {
        const registry = createToolRegistry();
        registry.register({
          id: "read_file",
          name: "read_file",
          description: "Read",
          source: "evir-local",
          riskLevel: "L1",
          schema: { type: "object" },
          execute: () => Promise.resolve({ success: true, output: "" }),
        });
        return registry;
      })(),
    };
    const harnessMiddlewareRegistry = new HarnessMiddlewareRegistry();
    harnessMiddlewareRegistry.registerProtected(
      createProtectedToolPolicyMiddleware(),
      "evir.host.tool-policy",
    );

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Write it" }],
      runtime: { ...readRuntime, harnessMiddlewareRegistry },
      onDelta: vi.fn(),
    });

    const lastTurn = result.turns.at(-1);
    expect(lastTurn?.stream.status).toBe("error");
    expect(lastTurn?.stream.errorMessage).toBe("tools.notAllowedByStep");
  });
});

function setupL3Runtime(execute: ToolDefinition["execute"]): EvirRuntime {
  const registry = createToolRegistry();
  registry.register({
    id: "write_file",
    name: "write_file",
    description: "Write a file",
    source: "evir-local",
    riskLevel: "L3",
    schema: { type: "object" },
    execute,
  });
  return {
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: (capability) => capability === "filesystem",
    toolRegistry: registry,
    toolExecutor: new ToolExecutor(registry),
  };
}

describe("runAgentLoop permission handling", () => {
  it("stops and sets pendingApproval for L3 tools", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "wrote" }));
    vi.mocked(streamAssistant).mockResolvedValueOnce({
      content: "I will write the file.",
      status: "complete",
      toolCalls: [
        { id: "call-1", toolName: "write_file", arguments: '{"path":"/tmp/a","content":"hi"}' },
      ],
    });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Write it" }],
      runtime: setupL3Runtime(execute),
      onDelta: vi.fn(),
    });

    expect(result.turns).toHaveLength(1);
    expect(result.maxIterationsReached).toBe(false);
    expect(result.turns[0]?.pendingApproval).toEqual({
      toolCallId: "call-1",
      toolName: "write_file",
      args: { path: "/tmp/a", content: "hi" },
      riskLevel: "L3",
      source: "evir-local",
      workspaceRoot: null,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
