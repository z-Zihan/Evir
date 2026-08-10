import { type AddressInfo, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { streamProvider } from "../src/provider-client";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

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
      config: {
        id: "fixture",
        name: "Fixture",
        protocolId: "openai-compatible-chat",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        modelId: "fixture",
        toolCalling: false,
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      },
      apiKey: "fixture-key",
      messages: [{ role: "user", content: "test" }],
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    });
    expect(result.content).toBe("Cli works");
    expect(deltas).toEqual(["Cli", " works"]);
  });
});
