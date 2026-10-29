import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../adapters/ollama-client";
import { ProviderErrorType, type ProviderStreamEvent } from "../stream-events";

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
  );
}

async function collect(adapter: OllamaClient): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.stream({ modelId: "llama-test", messages: [] })) {
    events.push(event);
  }
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe("OllamaClient", () => {
  it("parses NDJSON message chunks and completes on done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          ndjsonResponse([
            '{"message":{"content":"Hello"},"done":false}\n{"done":true,"done_reason":"stop","eval_count":7}\n',
          ]),
        ),
      ),
    );

    const events = await collect(new OllamaClient({ baseUrl: "http://localhost:11434" }));

    const start = events.find((event) => event.type === "response-start");
    expect(start).toMatchObject({
      type: "response-start",
      providerId: "ollama",
    });
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hello" },
    ]);
    const last = events.at(-1);
    expect(
      last?.type === "response-complete" ? [last.responseId, last.finishReason] : undefined,
    ).toEqual([start?.type === "response-start" ? start.responseId : undefined, "stop"]);
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
                controller.enqueue(encoder.encode('{"message":{"content":"partial"}}\n'));
              },
              pull(controller) {
                controller.error(new TypeError("network error"));
              },
            }),
            { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
          ),
      ),
    );

    const events = await collect(new OllamaClient({ baseUrl: "http://localhost:11434" }));

    expect(events.some((event) => event.type === "response-start")).toBe(true);
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

  it("reports an incomplete response when a stream closes without done:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(ndjsonResponse(['{"message":{"content":"partial"},"done":false}\n'])),
      ),
    );

    const events = await collect(new OllamaClient({ baseUrl: "http://localhost:11434" }));

    expect(events.some((event) => event.type === "response-start")).toBe(true);
    expect(events.some((event) => event.type === "response-complete")).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "error",
      error: {
        type: ProviderErrorType.NETWORK_ERROR,
        message: "Provider stream ended before completion",
        retryable: true,
      },
    });
  });
});
