// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../../core/storage/db";
import type { EvirRuntime } from "../../../runtime/types";
import { runAgentLoop } from "../agent-loop";
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

const runtime = {
  target: "desktop",
  capabilities: new Set(["filesystem"]),
  has: (capability: string) => capability === "filesystem",
} satisfies EvirRuntime;

function transientError(errorType: string): {
  content: string;
  status: "error";
  errorMessage: string;
  errorType: string;
  retryable: true;
} {
  return {
    content: "",
    status: "error",
    errorMessage: "transport failed",
    errorType,
    retryable: true,
  };
}

beforeEach(() => {
  // resetAllMocks clears mockResolvedValueOnce queues left by the previous
  // test; clearAllMocks would let a stale once-value leak across cases.
  vi.resetAllMocks();
  vi.useFakeTimers();
});

describe("agent-loop transient stream retry (H)", () => {
  it("retries a timeout that produced no output and then completes", async () => {
    vi.mocked(streamAssistant)
      .mockResolvedValueOnce(transientError("TIMEOUT"))
      .mockResolvedValueOnce({ content: "Recovered answer", status: "complete" });
    const onDelta = vi.fn();

    const promise = runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "hi" }],
      runtime,
      onDelta,
    });
    // Flush the 1s backoff under fake timers.
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await promise;

    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(2);
    expect(result.turns.at(-1)?.stream.content).toBe("Recovered answer");
    expect(onDelta).toHaveBeenCalledWith(expect.stringContaining("正在重试 1/2"));
  });

  it("caps retries at two and surfaces the final failure", async () => {
    vi.mocked(streamAssistant).mockImplementation(() =>
      Promise.resolve(transientError("NETWORK_ERROR")),
    );

    const promise = runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "hi" }],
      runtime,
      onDelta: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    // 1 initial + 2 retries = 3 calls, then the loop stops retrying.
    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(3);
    expect(result.turns.at(-1)?.stream.status).toBe("error");
  });

  it("does not retry once output was already consumed", async () => {
    vi.mocked(streamAssistant)
      .mockResolvedValueOnce({
        content: "partial answer already delivered",
        status: "error",
        errorMessage: "stream died mid-flight",
        errorType: "NETWORK_ERROR",
        retryable: true,
      })
      .mockResolvedValueOnce({ content: "should not be reached", status: "complete" });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "hi" }],
      runtime,
      onDelta: vi.fn(),
    });

    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(1);
    expect(result.turns.at(-1)?.stream.status).toBe("error");
  });

  it("does not retry non-retryable provider errors", async () => {
    vi.mocked(streamAssistant).mockResolvedValueOnce({
      content: "",
      status: "error",
      errorMessage: "unauthorized",
      errorType: "AUTH_FAILED",
      retryable: false,
    });

    const result = await runAgentLoop({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "hi" }],
      runtime,
      onDelta: vi.fn(),
    });

    expect(vi.mocked(streamAssistant)).toHaveBeenCalledTimes(1);
    expect(result.turns.at(-1)?.stream.status).toBe("error");
  });
});
