import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfiguredAdapter, getAdapter, listModelsForProtocol } from "../adapter-registry";
import { OpenAIChatCompletionsAdapter } from "../adapters/openai-chat-completions";
import { chatEndpoint, mapHttpError, mapThrownError } from "../adapters/openai-chat-utils";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderStreamEvent,
} from "../stream-events";
import type { ProviderRecord } from "../../storage/db";
import { stopActiveStream, streamAssistant } from "../../../features/chat/chat-stream";
import { useUsageStore } from "../../../features/usage/usage-store";
import { logger } from "../../logging/logger";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

async function collect(adapter: ProtocolAdapter): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.stream({ modelId: "gpt-test", messages: [] })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.useRealTimers();
  stopActiveStream();
  vi.unstubAllGlobals();
  logger.clear();
});

describe("OpenAIChatCompletionsAdapter", () => {
  it.each([
    ["https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions"],
    [
      "https://open.bigmodel.cn/api/paas/v4/",
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    ],
    ["https://api.deepseek.com", "https://api.deepseek.com/chat/completions"],
    ["https://example.com/custom/chat/completions", "https://example.com/custom/chat/completions"],
  ])("resolves the chat endpoint from API base %s", (baseUrl, expected) => {
    expect(chatEndpoint(baseUrl)).toBe(expected);
  });

  it("lists model ids using the configured OpenAI endpoint and authorization", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "gpt-one" }, { id: "gpt-two" }] })),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const models = await listModelsForProtocol("openai-chat-completions", {
      providerId: "openai",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
    });

    expect(models).toEqual(["gpt-one", "gpt-two"]);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/models", {
      headers: { Authorization: "Bearer test-key" },
    });
  });

  it("parses SSE across chunk boundaries", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          'data: {"id":"response-1","choices":[{"delta":{"content":"Hel"}}]}\n',
          '\ndata: {"id":"response-1","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\ndata: [DO',
          "NE]\n\n",
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));

    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
    ]);
    expect(events.at(-1)).toEqual({
      type: "response-complete",
      responseId: "response-1",
      finishReason: "stop",
    });
  });

  it.each([
    [401, ProviderErrorType.AUTH_FAILED],
    [404, ProviderErrorType.MODEL_NOT_FOUND],
    [429, ProviderErrorType.RATE_LIMITED],
    [500, ProviderErrorType.PROVIDER_ERROR],
  ])("maps HTTP %s to %s", async (status, expectedType) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "Request failed" } }), { status }),
        ),
      ),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(error?.type === "error" ? error.error.type : undefined).toBe(expectedType);
  });

  it("preserves safe provider error fields for diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "quota_exhausted",
                message: "No balance available",
                type: "billing_error",
                authorization: "Bearer sk-provider-secret-123456",
              },
            }),
            { status: 429, headers: { "x-request-id": "request-123" } },
          ),
        ),
      ),
    );

    const adapter = new OpenAIChatCompletionsAdapter({ apiKey: "test-key" });
    const result = await adapter.testConnection({
      providerId: "provider-1",
      modelId: "glm-5",
      authConfig: { baseUrl: "https://example.com/v1", apiKey: "test-key" },
    });

    expect(result.error?.providerDetails).toEqual({
      status: 429,
      code: "quota_exhausted",
      errorType: "billing_error",
      requestId: "request-123",
      responseFormat: "json",
    });
    expect(JSON.stringify(result.error?.providerDetails)).not.toContain("sk-provider-secret");
  });

  it("extracts final usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'data: {"id":"response-1","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\n',
            "data: [DONE]\n\n",
          ]),
        ),
      ),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));

    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    });
  });

  it("keeps one tool call id while streaming argument fragments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"/tmp/a\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
            "data: [DONE]\n\n",
          ]),
        ),
      ),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));

    expect(events.filter((event) => event.type === "tool-call-start")).toEqual([
      { type: "tool-call-start", toolCallId: "call-1", toolName: "read_file" },
    ]);
    expect(events.filter((event) => event.type === "tool-call-arguments-delta")).toEqual([
      { type: "tool-call-arguments-delta", toolCallId: "call-1", argumentsDelta: '{"path":' },
      { type: "tool-call-arguments-delta", toolCallId: "call-1", argumentsDelta: '"/tmp/a"}' },
    ]);
  });

  it("completes when finish_reason is received without a DONE event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'data: {"id":"response-1","choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));

    expect(events.at(-1)).toEqual({
      type: "response-complete",
      responseId: "response-1",
      finishReason: "stop",
    });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("creates a response id when randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(sseResponse(["data: [DONE]\n\n"]))),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));
    const start = events.find((event) => event.type === "response-start");

    expect(start?.type === "response-start" ? start.responseId : undefined).toMatch(/^\d+-\w+$/);
  });

  it("parses a plain JSON completion when the provider ignores stream:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "json-response",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Deterministic non-stream response.",
                    tool_calls: [
                      {
                        id: "call-json-1",
                        type: "function",
                        function: { name: "read_file", arguments: '{"path":"/tmp/a"}' },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Deterministic non-stream response." },
    ]);
    expect(events.filter((event) => event.type === "tool-call-start")).toEqual([
      { type: "tool-call-start", toolCallId: "call-json-1", toolName: "read_file" },
    ]);
    expect(events.filter((event) => event.type === "tool-call-end")).toHaveLength(1);
    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
    });
    expect(events.at(-1)).toEqual({
      type: "response-complete",
      responseId: "json-response",
      finishReason: "tool_calls",
    });
  });

  it("reports a lost connection instead of CORS when a stream drops mid-flight", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
                );
                controller.error(new TypeError("network error"));
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    const events = await collect(new OpenAIChatCompletionsAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(
      error?.type === "error"
        ? [error.error.type, error.error.message, error.error.retryable]
        : undefined,
    ).toEqual([
      ProviderErrorType.NETWORK_ERROR,
      "Connection lost while receiving the response",
      true,
    ]);
  });

  it("classifies Chinese insufficient-balance provider messages as billing errors", () => {
    expect(mapHttpError(429, "余额不足或无可用资源包,请充值。")).toMatchObject({
      type: ProviderErrorType.INSUFFICIENT_BALANCE,
      retryable: false,
    });
    expect(mapHttpError(429, "账户欠费，请充值后重试")).toMatchObject({
      type: ProviderErrorType.INSUFFICIENT_BALANCE,
    });
    expect(mapHttpError(429, "Requests per minute limit reached")).toMatchObject({
      type: ProviderErrorType.RATE_LIMITED,
    });
  });

  it("keeps CORS classification for pre-response TypeErrors but not mid-stream ones", () => {
    const typeError = new TypeError("Failed to fetch");
    expect(mapThrownError(typeError)).toMatchObject({
      type: ProviderErrorType.CORS_BLOCKED,
    });
    expect(mapThrownError(typeError, undefined, true)).toMatchObject({
      type: ProviderErrorType.NETWORK_ERROR,
    });
    expect(mapThrownError(typeError, undefined, true).retryable).toBe(true);
  });
});

describe("adapter registry", () => {
  it("reports model discovery as unavailable for Anthropic", async () => {
    await expect(
      listModelsForProtocol("anthropic-messages", {
        providerId: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "test-key",
      }),
    ).resolves.toBeUndefined();
  });

  it("returns independent adapter instances", () => {
    expect(getAdapter("openai-chat-completions")).not.toBe(getAdapter("openai-chat-completions"));
    expect(
      createConfiguredAdapter("openai-compatible-chat", {
        providerId: "provider-1",
        baseUrl: "https://example.com/v1",
        apiKey: "test-key",
      }),
    ).not.toBe(
      createConfiguredAdapter("openai-compatible-chat", {
        providerId: "provider-2",
        baseUrl: "https://example.org/v1",
        apiKey: "test-key",
      }),
    );
  });
});

describe("streamAssistant", () => {
  it("persists one provider-backed usage record per completed model request", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'data: {"id":"response-usage","choices":[{"delta":{"content":"Hi"}}]}\n\n',
            'data: {"id":"response-usage","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\n',
            'data: {"id":"response-usage","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            "data: [DONE]\n\n",
          ]),
        ),
      ),
    );
    const provider: ProviderRecord = {
      id: "provider-usage",
      name: "Provider",
      protocolId: "openai-compatible-chat",
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      modelId: "model-usage",
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = await streamAssistant(
      provider,
      "conversation-usage",
      [{ role: "user", content: "hello" }],
      () => undefined,
    );
    const records = useUsageStore
      .getState()
      .records.filter(({ conversationId }) => conversationId === "conversation-usage");

    expect(result.status).toBe("complete");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      evidence: "provider",
      success: true,
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 7,
    });
    expect(records[0]?.firstTokenMs).toBeTypeOf("number");
  });

  it("supports parallel worker streams and cancels all active streams", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const provider: ProviderRecord = {
      id: "provider-1",
      name: "Provider",
      protocolId: "openai-compatible-chat",
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      modelId: "model-1",
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };

    const first = streamAssistant(provider, "conversation-1", [], () => undefined);
    const second = streamAssistant(provider, "conversation-1", [], () => undefined);
    stopActiveStream();
    await expect(first).resolves.toMatchObject({ status: "stopped" });
    await expect(second).resolves.toMatchObject({ status: "stopped" });
  });

  it("stops a structured request when its deadline expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const provider: ProviderRecord = {
      id: "provider-timeout",
      name: "Provider",
      protocolId: "openai-compatible-chat",
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      modelId: "model-1",
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };

    const request = streamAssistant(
      provider,
      "conversation-timeout",
      [],
      () => undefined,
      undefined,
      undefined,
      10,
    );

    await expect(request).resolves.toMatchObject({
      status: "error",
      errorMessage: "chat.requestTimedOut",
    });
    expect(
      useUsageStore
        .getState()
        .records.find(({ conversationId }) => conversationId === "conversation-timeout"),
    ).toMatchObject({ evidence: "unavailable", success: false, errorType: "TIMEOUT" });
    expect(
      logger
        .getEntries()
        .find(
          ({ event, conversationId }) =>
            event === "provider.request-completed" && conversationId === "conversation-timeout",
        ),
    ).toMatchObject({ data: { status: "error", errorType: "TIMEOUT" } });
  });
});
