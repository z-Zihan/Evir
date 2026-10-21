import { type AddressInfo, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { streamProvider, testProvider } from "../src/provider-client";
import { ProviderErrorType } from "../../../src/core/providers/stream-events";
import { mapProviderErrorTypeToExitCode } from "../src/exit-codes";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function fixtureConfig(baseUrl: string) {
  return {
    id: "fixture",
    name: "Fixture",
    protocolId: "openai-compatible-chat" as const,
    baseUrl,
    modelId: "fixture",
    toolCalling: false,
    enabled: true,
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("CLI provider streaming", () => {
  it("prints real incremental SSE deltas through the shared Evir adapter", async () => {
    const server = createServer((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n");
        socket.write(
          `data: ${JSON.stringify({ id: "1", choices: [{ delta: { content: "Cli" } }] })}\n\n`,
        );
        socket.write(
          `data: ${JSON.stringify({ id: "1", choices: [{ delta: { content: " works" }, finish_reason: "stop" }] })}\n\n`,
        );
        socket.write("data: [DONE]\n\n");
        socket.end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const deltas: string[] = [];
    const result = await streamProvider({
      config: fixtureConfig(`http://127.0.0.1:${address.port}/v1`),
      apiKey: "fixture-key",
      messages: [{ role: "user", content: "test" }],
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    });
    expect(result.content).toBe("Cli works");
    expect(deltas).toEqual(["Cli", " works"]);
  });

  it("classifies a 401 response as errorType AUTH_FAILED, mapped from the shared ProviderError", async () => {
    const server = createServer((socket) => {
      socket.once("data", () => {
        const body = JSON.stringify({ error: { message: "Invalid API key" } });
        socket.write(
          `HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
        );
        socket.end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const result = await streamProvider({
      config: fixtureConfig(`http://127.0.0.1:${address.port}/v1`),
      apiKey: "fixture-key",
      messages: [{ role: "user", content: "test" }],
      signal: new AbortController().signal,
      onDelta: () => {},
    });
    expect(result.error).toBe("Invalid API key");
    expect(result.errorKind).toBe("provider");
    expect(result.errorType).toBe(ProviderErrorType.AUTH_FAILED);
    expect(result.retryable).toBe(false);
  });

  it("classifies a refused connection via testProvider using the shared ProviderError", async () => {
    // Node's fetch (undici) throws the same TypeError for a pre-stream
    // connection failure as a browser CORS rejection; the shared
    // `mapThrownError` (openai-chat-utils.ts) cannot distinguish them before
    // any response data arrives, so this classifies as CORS_BLOCKED rather
    // than NETWORK_ERROR. Verified empirically against a closed port before
    // writing this assertion. In the CLI, CORS_BLOCKED therefore means a
    // pre-stream connection failure, which mapProviderErrorTypeToExitCode
    // correctly routes to exit code 4 (network family), not 3
    // (credential/auth family).
    const result = await testProvider(fixtureConfig("http://127.0.0.1:1/v1"), "fixture-key");
    expect(result.ok).toBe(false);
    expect(result.errorType).toBe(ProviderErrorType.CORS_BLOCKED);
    expect(mapProviderErrorTypeToExitCode(result.errorType ?? ProviderErrorType.CORS_BLOCKED)).toBe(
      4,
    );
  });
});
