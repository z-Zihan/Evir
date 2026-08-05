import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIChatCompletionsAdapter } from "../adapters/openai-chat-completions";
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

async function collect(adapter: OpenAIChatCompletionsAdapter): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.stream({ modelId: "gpt-test", messages: [] })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIChatCompletionsAdapter", () => {
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
});
