import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../../../core/providers/tool-registry";
import type { ProviderRecord } from "../../../core/storage/db";
import { ToolExecutor } from "../../../core/tools/tool-executor";
import { createToolRegistry } from "../../../core/tools/tool-registry-impl";
import type { EvirRuntime } from "../../../runtime/types";
import { MAX_AGENT_ITERATIONS, runAgentLoop } from "../agent-loop";
import { streamAssistant } from "../chat-stream";

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
      toolName: "write_file",
      args: { path: "/tmp/a", content: "hi" },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
