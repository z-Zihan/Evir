import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicMessagesAdapter } from "../adapters/anthropic-messages";
import { ProviderErrorType, type ProviderStreamEvent } from "../stream-events";

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

async function collect(adapter: AnthropicMessagesAdapter): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.stream({ modelId: "claude-test", messages: [] })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicMessagesAdapter", () => {
  it("parses event/data pairs across chunks and extracts text, usage, and completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1"}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel',
            'lo"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new AnthropicMessagesAdapter({ apiKey: "test-key" }));

    expect(events.find((event) => event.type === "response-start")).toEqual({
      type: "response-start",
      responseId: "msg-1",
      modelId: "claude-test",
      providerId: "anthropic",
    });
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hello" },
    ]);
    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: { outputTokens: 42 },
    });
    expect(events.at(-1)).toEqual({
      type: "response-complete",
      responseId: "msg-1",
      finishReason: "end_turn",
    });
  });

  it("uses the Anthropic endpoint, headers, and request shape", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(sseResponse(['event: message_stop\ndata: {"type":"message_stop"}\n\n'])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AnthropicMessagesAdapter({
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
    });
    await collect(adapter);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        },
      }),
    );
  });

  it.each([
    [401, ProviderErrorType.AUTH_FAILED],
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

    const events = await collect(new AnthropicMessagesAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(error?.type === "error" ? error.error.type : undefined).toBe(expectedType);
  });

  it("maps an Anthropic error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Busy"}}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new AnthropicMessagesAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(error?.type === "error" ? error.error : undefined).toMatchObject({
      type: ProviderErrorType.PROVIDER_ERROR,
      message: "Busy",
      retryable: true,
    });
  });
});
