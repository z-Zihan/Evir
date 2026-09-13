#!/usr/bin/env node
/**
 * Minimal real MCP stdio server for integration tests (MCP-1): JSON-RPC over
 * stdio, line-delimited. Supports initialize / tools/list / tools/call. The
 * `echo` tool returns its input.
 */
import { createInterface } from "node:readline";

const readline = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

readline.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "evir-fixture-stdio", version: "1.0.0" },
    });
  } else if (method === "notifications/initialized") {
    // notification: no reply
  } else if (method === "tools/list") {
    reply(id, {
      tools: [
        {
          name: "echo",
          description: "Echo back the provided text (integration fixture)",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ],
    });
  } else if (method === "tools/call") {
    if (params?.name === "echo") {
      reply(id, {
        content: [{ type: "text", text: `fixture echo: ${params.arguments?.text ?? ""}` }],
      });
    } else {
      reply(id, {
        content: [{ type: "text", text: `unknown tool ${params?.name}` }],
        isError: true,
      });
    }
  } else if (method === "ping") {
    reply(id, {});
  }
});

readline.on("close", () => process.exit(0));
