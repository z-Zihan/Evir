import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../../core/storage/db";
import type { ToolExecutor } from "../../../core/tools/tool-executor";
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

function setupRuntime(execute: ToolExecutor["execute"]): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: (capability) => capability === "filesystem",
    toolRegistry: createToolRegistry(),
    toolExecutor: { execute } as unknown as ToolExecutor,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("agent-loop end-to-end workflows", () => {
  it("Agent reads file and modifies it", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ success: true, output: "file contents" })
      .mockResolvedValueOnce({ success: true, output: "patch applied" });

    vi.mocked(streamAssistant)
      .mockResolvedValueOnce({
        content: "",
        status: "complete",
        toolCalls: [{ id: "call-1", toolName: "read_file", arguments: '{"path":"/tmp/a"}' }],
      })
      .mockResolvedValueOnce({
        content: "",
        status: "complete",
        toolCalls: [
          {
            id: "call-2",
            toolName: "apply_patch",
            arguments: '{"path":"/tmp/a","patch":"diff"}',
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Done", status: "complete" });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Update the file" }],
      runtime: setupRuntime(execute),
      onDelta: vi.fn(),
    });

    expect(result.turns).toHaveLength(3);
    expect(result.turns[0]?.toolCalls?.[0]).toMatchObject({ toolName: "read_file" });
    expect(result.turns[0]?.toolResults?.[0]).toMatchObject({
      success: true,
      output: "file contents",
    });
    expect(result.turns[1]?.toolCalls?.[0]).toMatchObject({ toolName: "apply_patch" });
    expect(result.turns[1]?.toolResults?.[0]).toMatchObject({
      success: true,
      output: "patch applied",
    });
    expect(result.turns[2]?.stream.content).toBe("Done");
    expect(result.turns[2]?.toolCalls).toBeUndefined();
    expect(result.maxIterationsReached).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("Agent runs command and verifies result", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ success: true, output: "stdout: build succeeded" });

    vi.mocked(streamAssistant)
      .mockResolvedValueOnce({
        content: "",
        status: "complete",
        toolCalls: [
          { id: "call-1", toolName: "run_command", arguments: '{"command":"npm run build"}' },
        ],
      })
      .mockResolvedValueOnce({ content: "Build succeeded", status: "complete" });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Run the build" }],
      runtime: setupRuntime(execute),
      onDelta: vi.fn(),
    });

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.toolResults?.[0]).toMatchObject({
      success: true,
      output: "stdout: build succeeded",
    });
    expect(result.turns[1]?.stream.content).toBe("Build succeeded");
    expect(result.maxIterationsReached).toBe(false);
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(2);
  });

  it("User rejects approval", async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      success: false,
      output: "Permission required",
      error: "permission_required",
    });

    vi.mocked(streamAssistant).mockResolvedValueOnce({
      content: "I will delete the file.",
      status: "complete",
      toolCalls: [{ id: "call-1", toolName: "delete_file", arguments: '{"path":"/tmp/a"}' }],
    });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Delete it" }],
      runtime: setupRuntime(execute),
      onDelta: vi.fn(),
    });

    expect(result.turns).toHaveLength(1);
    expect(result.maxIterationsReached).toBe(false);
    expect(result.turns[0]?.pendingApproval).toEqual({
      toolCallId: "call-1",
      toolName: "delete_file",
      args: { path: "/tmp/a" },
    });
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(1);
  });

  it("Agent hits max iterations", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "same" }));
    vi.mocked(streamAssistant).mockResolvedValue({
      content: "",
      status: "complete",
      toolCalls: [{ id: "call-1", toolName: "read_file", arguments: "{}" }],
    });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Loop forever" }],
      runtime: setupRuntime(execute),
      onDelta: vi.fn(),
    });

    expect(result.maxIterationsReached).toBe(true);
    expect(result.turns).toHaveLength(MAX_AGENT_ITERATIONS);
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
  });

  it("Agent stops on error", async () => {
    const execute = vi.fn();
    vi.mocked(streamAssistant).mockResolvedValueOnce({
      content: "",
      status: "error",
      errorMessage: "chat.protocolUnsupported",
    });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "Do something" }],
      runtime: setupRuntime(execute),
      onDelta: vi.fn(),
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.stream.status).toBe("error");
    expect(result.maxIterationsReached).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(1);
  });
});
