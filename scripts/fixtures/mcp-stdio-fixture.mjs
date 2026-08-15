import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === "notifications/initialized") {
    send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "evir-native-fixture", version: "1.0.0" },
      },
    });
    return;
  }
  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "fixture_echo",
            description: "Echo text and report the persistent MCP process id.",
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
  if (request.method === "tools/call") {
    const text =
      typeof request.params?.arguments?.text === "string" ? request.params.arguments.text : "";
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: `${text} (pid ${process.pid})` }],
      },
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: `Method not found: ${String(request.method)}` },
  });
});
