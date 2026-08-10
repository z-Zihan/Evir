import { type AddressInfo, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderClient } from "../src/provider-client";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function sseServer(chunks: string[]): Promise<string> {
  const server = createServer((socket) => {
    socket.once("data", () => {
      socket.write(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
      );
      for (const chunk of chunks) socket.write(`data: ${chunk}\n\n`);
      socket.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1`;
}

describe("ProviderClient", () => {
  it("reuses the Evir provider adapter for real incremental SSE", async () => {
    const baseUrl = await sseServer([
      JSON.stringify({ id: "r1", choices: [{ delta: { content: "Hel" } }] }),
      JSON.stringify({ id: "r1", choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] }),
      "[DONE]",
    ]);
    const deltas: string[] = [];
    const result = await new ProviderClient().stream(
      {
        protocolId: "openai-compatible-chat",
        baseUrl,
        modelId: "test-model",
        toolCalling: false,
      },
      "test-key",
      [{ role: "user", content: "Hi" }],
      undefined,
      new AbortController().signal,
      (content) => deltas.push(content),
    );

    expect(result).toMatchObject({ content: "Hello", completed: true, stopped: false });
    expect(deltas).toEqual(["Hel", "Hello"]);
  });
});
