import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_MCP_RESPONSE_BYTES } from "../protocol";
import { HttpMcpTransport } from "../transports";

const noSecrets = <T>(): Promise<T> => Promise.resolve(null as T);

async function readRequest(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const value: unknown = chunk;
    if (typeof value === "string" || value instanceof Uint8Array) chunks.push(Buffer.from(value));
    else throw new Error("Unexpected request body chunk");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/mcp`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("HttpMcpTransport integration", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  it("maintains the negotiated session across initialize, notification, list, call, and close", async () => {
    const seen: Array<{ method: string; session?: string; protocol?: string }> = [];
    let deleted = false;
    const handleRequest = async (
      request: import("node:http").IncomingMessage,
      response: import("node:http").ServerResponse,
    ) => {
      if (request.method === "DELETE") {
        deleted = true;
        response.writeHead(200).end();
        return;
      }
      const message = (await readRequest(request)) as {
        id?: number;
        method: string;
      };
      seen.push({
        method: message.method,
        ...(request.headers["mcp-session-id"]
          ? { session: String(request.headers["mcp-session-id"]) }
          : {}),
        ...(request.headers["mcp-protocol-version"]
          ? { protocol: String(request.headers["mcp-protocol-version"]) }
          : {}),
      });
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "http-fixture" },
            }
          : message.method === "tools/list"
            ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
            : { content: [{ type: "text", text: "echoed" }] };
      response.writeHead(200, {
        "Content-Type": "application/json",
        ...(message.method === "initialize" ? { "Mcp-Session-Id": "session-1" } : {}),
      });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    };
    const server = createServer((request, response) => {
      void handleRequest(request, response).catch(() => response.writeHead(500).end());
    });
    servers.push(server);
    const url = await listen(server);
    const transport = new HttpMcpTransport(
      {
        id: "http-fixture",
        name: "HTTP fixture",
        transport: "streamable-http",
        url,
        headerSecretRefs: {},
        enabled: true,
      },
      noSecrets,
    );

    const initialized = (await transport.request("initialize")) as { protocolVersion: string };
    transport.setProtocolVersion(initialized.protocolVersion);
    await transport.notify("notifications/initialized");
    await expect(transport.request("tools/list")).resolves.toMatchObject({
      tools: [{ name: "echo" }],
    });
    await expect(
      transport.request("tools/call", { name: "echo", arguments: {} }),
    ).resolves.toMatchObject({
      content: [{ text: "echoed" }],
    });
    await transport.close();

    expect(seen).toEqual([
      { method: "initialize" },
      { method: "notifications/initialized", session: "session-1", protocol: "2025-06-18" },
      { method: "tools/list", session: "session-1", protocol: "2025-06-18" },
      { method: "tools/call", session: "session-1", protocol: "2025-06-18" },
    ]);
    expect(deleted).toBe(true);
  });

  it("cancels an in-flight HTTP request", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
      }, 200);
    });
    servers.push(server);
    const url = await listen(server);
    const transport = new HttpMcpTransport(
      {
        id: "slow",
        name: "Slow",
        transport: "streamable-http",
        url,
        headerSecretRefs: {},
        enabled: true,
      },
      noSecrets,
    );
    const controller = new AbortController();
    const pending = transport.request("initialize", {}, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps the timeout active while consuming the response body", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
    });
    servers.push(server);
    const url = await listen(server);
    const transport = new HttpMcpTransport(
      {
        id: "body-timeout",
        name: "Body timeout",
        transport: "streamable-http",
        url,
        headerSecretRefs: {},
        enabled: true,
      },
      noSecrets,
    );

    await expect(transport.request("initialize", {}, { timeoutMs: 25 })).rejects.toThrow(
      "MCP request timed out",
    );
    await transport.close();
  });

  it("stops reading a streamed response at the byte limit", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      const chunk = Buffer.alloc(64 * 1024, 120);
      for (let written = 0; written <= MAX_MCP_RESPONSE_BYTES; written += chunk.length) {
        response.write(chunk);
      }
      response.end();
    });
    servers.push(server);
    const url = await listen(server);
    const transport = new HttpMcpTransport(
      {
        id: "oversized",
        name: "Oversized",
        transport: "streamable-http",
        url,
        headerSecretRefs: {},
        enabled: true,
      },
      noSecrets,
    );

    await expect(transport.request("initialize")).rejects.toThrow(
      "MCP response exceeds the size limit",
    );
    await transport.close();
  });

  it("delivers tool-list notifications from the server event stream", async () => {
    const notified = deferred<string>();
    const handleEventRequest = async (
      request: import("node:http").IncomingMessage,
      response: import("node:http").ServerResponse,
    ) => {
      if (request.method === "DELETE") {
        response.writeHead(200).end();
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n');
        return;
      }
      const message = (await readRequest(request)) as { id?: number; method: string };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "events-session",
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "event-fixture" },
          },
        }),
      );
    };
    const server = createServer((request, response) => {
      void handleEventRequest(request, response).catch(() => response.writeHead(500).end());
    });
    servers.push(server);
    const url = await listen(server);
    const transport = new HttpMcpTransport(
      {
        id: "events",
        name: "Events",
        transport: "streamable-http",
        url,
        headerSecretRefs: {},
        enabled: true,
      },
      noSecrets,
    );
    transport.onNotification((method) => {
      if (method === "notifications/tools/list_changed") notified.resolve(method);
    });

    const initialized = (await transport.request("initialize")) as { protocolVersion: string };
    transport.setProtocolVersion(initialized.protocolVersion);

    await expect(notified.promise).resolves.toBe("notifications/tools/list_changed");
    await transport.close();
  });
});
