import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const portArgument = process.argv.indexOf("--port");
const requestedPort = portArgument >= 0 ? Number(process.argv[portArgument + 1]) : 0;
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  throw new Error("--port must be an integer between 0 and 65535");
}

const sessions = new Map();

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error("Request body exceeds fixture limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, MCP-Protocol-Version, Mcp-Session-Id",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (request.url !== "/mcp") {
    response.writeHead(404).end();
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const sessionId = request.headers["mcp-session-id"];
  if (request.method === "DELETE") {
    if (typeof sessionId === "string") sessions.delete(sessionId);
    response.writeHead(204).end();
    return;
  }

  if (request.method === "GET") {
    if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(
      `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`,
    );
    sessions.get(sessionId).streams.add(response);
    request.on("close", () => sessions.get(sessionId)?.streams.delete(response));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  try {
    const message = await readJson(request);
    if (message.method === "initialize") {
      const nextSessionId = randomUUID();
      sessions.set(nextSessionId, { streams: new Set() });
      json(
        response,
        200,
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "evir-http-fixture", version: "1.0.0" },
          },
        },
        { "Mcp-Session-Id": nextSessionId },
      );
      return;
    }
    if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
      json(response, 404, { error: "Unknown MCP session" });
      return;
    }
    if (message.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    if (message.method === "tools/list") {
      json(response, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "fixture_echo",
              description: "Echo text and report the HTTP fixture process and session.",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
                additionalProperties: false,
              },
            },
          ],
        },
      });
      return;
    }
    if (message.method === "tools/call") {
      const text =
        typeof message.params?.arguments?.text === "string" ? message.params.arguments.text : "";
      json(response, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: `${text} (pid ${process.pid}, session ${sessionId})` }],
        },
      });
      return;
    }
    json(response, 200, {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Method not found: ${String(message.method)}` },
    });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  process.stdout.write(`http://127.0.0.1:${address.port}/mcp\n`);
});

function shutdown() {
  for (const session of sessions.values()) {
    for (const stream of session.streams) stream.end();
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
