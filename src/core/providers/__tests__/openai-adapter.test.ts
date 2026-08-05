import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfiguredAdapter, getAdapter, listModelsForProtocol } from "../adapter-registry";
import { OpenAIChatCompletionsAdapter } from "../adapters/openai-chat-completions";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderStreamEvent,
} from "../stream-events";
import type { ProviderRecord } from "../../storage/db";
import { stopActiveStream, streamAssistant } from "../../../features/chat/chat-stream";

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
  stopActiveStream();
  vi.unstubAllGlobals();
});

describe("OpenAIChatCompletionsAdapter", () => {
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
  it("rejects a second stream while one is active", async () => {
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
    const second = await streamAssistant(provider, "conversation-1", [], () => undefined);

    expect(second).toEqual({
      content: "",
      status: "error",
      errorMessage: "chat.alreadyStreaming",
    });
    stopActiveStream();
    await expect(first).resolves.toMatchObject({ status: "stopped" });
  });
});
