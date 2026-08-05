import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiGenerateContentAdapter } from "../adapters/gemini-generate-content";
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

async function collect(
  adapter: ProtocolAdapter,
  messages: unknown[] = [],
): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.stream({ modelId: "gemini-test", messages })) {
    events.push(event);
  }
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe("GeminiGenerateContentAdapter", () => {
  it("extracts text from every candidate content part", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'data: {"candidates":[{"content":{"parts":[{"text":"Hel"},{"text":"lo"}],"role":"model"},"finishReason":"STOP"}]}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new GeminiGenerateContentAdapter({ apiKey: "test-key" }));

    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
    ]);
  });

  it("extracts usage and maps finishReason to completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}\n\n',
          ]),
        ),
      ),
    );

    const events = await collect(new GeminiGenerateContentAdapter({ apiKey: "test-key" }));

    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    expect(events.at(-1)).toMatchObject({
      type: "response-complete",
      finishReason: "STOP",
    });
  });

  it.each([
    [400, ProviderErrorType.PROVIDER_ERROR],
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

    const events = await collect(new GeminiGenerateContentAdapter({ apiKey: "test-key" }));
    const error = events.find((event) => event.type === "error");

    expect(error?.type === "error" ? error.error.type : undefined).toBe(expectedType);
  });

  it("extracts system instructions and maps assistant history to the model role", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sseResponse(['data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}\n\n']),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(new GeminiGenerateContentAdapter({ apiKey: "secret" }), [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const call = calls[0];
    const url = call?.[0];
    const init = call?.[1];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      contents: [
        { role: "user", parts: [{ text: "Hi" }] },
        { role: "model", parts: [{ text: "Hello" }] },
      ],
      systemInstruction: { parts: [{ text: "Be concise" }] },
    });
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "secret",
    });
  });
});
