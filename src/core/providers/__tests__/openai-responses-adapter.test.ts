import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIResponsesAdapter } from "../adapters/openai-responses";
import {
  ProviderErrorType,
  type ProtocolAdapter,
  type ProviderStreamEvent,
} from "../stream-events";

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
  for await (const event of adapter.stream({
    modelId: "gpt-test",
    messages: [{ role: "user", content: "Hi" }],
  })) {
    events.push(event);
  }
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIResponsesAdapter", () => {
  it("parses event/data pairs and extracts output text deltas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel',
            'lo"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1"}}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new OpenAIResponsesAdapter({ apiKey: "test-key" }));

    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hello" },
    ]);
    expect(events.at(-1)).toEqual({
      type: "response-complete",
      responseId: "resp-1",
      finishReason: "completed",
    });
  });

  it("extracts usage from response.completed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":10,"total_tokens":15}}}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new OpenAIResponsesAdapter({ apiKey: "test-key" }));

    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
    });
  });

  it.each(["response.failed", "error"])("maps the %s SSE event to an error", async (type) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            `event: ${type}\ndata: {"type":"${type}","error":{"code":"server_error","message":"Failed"}}\n\n`,
          ]),
        ),
      ),
    );

    const events = await collect(new OpenAIResponsesAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(error?.type === "error" ? error.error : undefined).toMatchObject({
      type: ProviderErrorType.PROVIDER_ERROR,
      message: "Failed",
      retryable: true,
    });
  });

  it.each([
    [401, ProviderErrorType.AUTH_FAILED],
    [429, ProviderErrorType.RATE_LIMITED],
    [500, ProviderErrorType.PROVIDER_ERROR],
  ])("maps HTTP %s to %s", async (status, expectedType) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: { message: "Failed" } }), { status })),
      ),
    );

    const events = await collect(new OpenAIResponsesAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(error?.type === "error" ? error.error.type : undefined).toBe(expectedType);
  });

  it("uses the Responses endpoint, Bearer auth, and input_text request shape", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n',
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(
      new OpenAIResponsesAdapter({
        baseUrl: "https://example.com/v1/",
        apiKey: "test-key",
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          model: "gpt-test",
          input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
          stream: true,
        }),
      }),
    );
  });
});
