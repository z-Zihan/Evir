import { createServer } from "node:http";

const port = 1430;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(response, status, body) {
  response.writeHead(status, { ...cors, "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function sse(response, chunks, delay = 18) {
  response.writeHead(200, {
    ...cors,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let index = 0;
  const timer = setInterval(() => {
    const chunk = chunks[index++];
    if (chunk === undefined) {
      clearInterval(timer);
      response.end();
      return;
    }
    response.write(`data: ${chunk}\n\n`);
  }, delay);
  response.on("close", () => clearInterval(timer));
}

function textChunks(text) {
  const parts = text.match(/.{1,12}/gu) ?? [];
  return [
    ...parts.map((content, index) =>
      JSON.stringify({
        id: "fixture-response",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      }),
    ),
    JSON.stringify({
      id: "fixture-response",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: parts.length,
        total_tokens: 12 + parts.length,
      },
    }),
    "[DONE]",
  ];
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = [...messages].reverse().find((message) => message?.role === "user");
  return typeof user?.content === "string" ? user.content : "";
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  if (request.url === "/health") return json(response, 200, { ok: true });
  if (request.url === "/v1/models") {
    return json(response, 200, { data: [{ id: "evir-fixture-model" }] });
  }
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
    return json(response, 404, { error: { message: "Fixture route not found" } });
  }

  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    const body = JSON.parse(raw);
    const prompt = lastUserText(body);
    if (prompt.includes("[auth-error]")) {
      return json(response, 401, { error: { message: "Fixture API key rejected" } });
    }
    if (prompt.includes("[server-error]")) {
      return json(response, 503, { error: { message: "Fixture provider unavailable" } });
    }
    if (prompt.includes("[invalid-sse]")) {
      return sse(response, ["{invalid-json", "[DONE]"]);
    }
    const reply = prompt.includes("[slow]")
      ? "This response is deliberately streamed slowly so cancellation can be verified without a paid API. ".repeat(
          8,
        )
      : "Deterministic fixture response. Streaming, persistence, and usage all use the production chat pipeline.";
    return sse(response, textChunks(reply), prompt.includes("[slow]") ? 80 : 18);
  });
});

server.listen(port, "127.0.0.1");
