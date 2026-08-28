import { createServer } from "node:http";

const port = 1430;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "x-request-id",
};

function json(response, status, body, headers = {}) {
  response.writeHead(status, { ...cors, "content-type": "application/json", ...headers });
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

// Scripted tool-calling turns so the real agent loop (registry, permissions,
// approval, execution) can be validated against this server without a paid
// provider. The step index is derived from how many tool results the loop has
// already sent back, so the sequence survives pauses and approvals.
const AGENT_SCRIPT = [
  { tool: "list_directory", args: { path: "." } },
  { tool: "read_file", args: { path: "notes.txt" } },
  { tool: "write_file", args: { path: "fixture-report.md", content: "# Fixture report\n\nwritten by the scripted agent fixture\n" } },
  { tool: "read_file", args: { path: "fixture-report.md" } },
];

const AGENT_RECOVERY_SCRIPT = [
  { tool: "list_directory", args: { path: "." } },
  { tool: "read_file", args: { path: "missing-on-purpose.txt" } },
  { tool: "write_file", args: { path: "recovery-note.md", content: "recovered after a failed read\n" } },
];

function scriptedToolTurn(body, script, finalText) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const toolResults = messages.filter((message) => message?.role === "tool").length;
  const step = script[toolResults];
  if (step) {
    return {
      chunks: [
        JSON.stringify({
          id: "fixture-agent-response",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `fixture-call-${toolResults + 1}`,
                    type: "function",
                    function: { name: step.tool, arguments: JSON.stringify(step.args) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        JSON.stringify({
          id: "fixture-agent-response",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        }),
        "[DONE]",
      ],
    };
  }
  return { chunks: textChunks(finalText) };
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

  if (request.headers.authorization === "Bearer sk-evir-e2e-quota-key") {
    return json(
      response,
      429,
      {
        error: {
          code: "quota_exhausted",
          type: "billing_error",
          message: "余额不足或无可用资源包,请充值。",
          authorization: "Bearer sk-evir-e2e-quota-key",
        },
      },
      { "x-request-id": "fixture-request-429" },
    );
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
    if (prompt.includes("[forbidden]")) {
      return json(response, 403, { error: { message: "Fixture request forbidden" } });
    }
    if (prompt.includes("[not-found]")) {
      return json(response, 404, { error: { message: "Fixture model not found" } });
    }
    if (prompt.includes("[server-500]")) {
      return json(response, 500, { error: { message: "Fixture internal error" } });
    }
    if (prompt.includes("[server-error]")) {
      return json(response, 503, { error: { message: "Fixture provider unavailable" } });
    }
    if (prompt.includes("[disconnect]")) {
      response.writeHead(200, {
        ...cors,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(`data: ${textChunks("partial")[0]}\n\n`);
      return setTimeout(() => response.destroy(), 20);
    }
    if (prompt.includes("[no-stream]")) {
      return json(response, 200, {
        id: "fixture-non-stream-response",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Deterministic non-stream response." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
      });
    }
    if (prompt.includes("[invalid-sse]")) {
      return sse(response, ["{invalid-json", "[DONE]"]);
    }
    if (prompt.includes("[agent-task]")) {
      const { chunks } = scriptedToolTurn(
        body,
        AGENT_SCRIPT,
        "Agent task complete: fixture-report.md written and read back. [agent-task]",
      );
      return sse(response, chunks);
    }
    if (prompt.includes("[agent-recovery]")) {
      const { chunks } = scriptedToolTurn(
        body,
        AGENT_RECOVERY_SCRIPT,
        "Recovered from the missing file and wrote recovery-note.md. [agent-recovery]",
      );
      return sse(response, chunks);
    }
    const reply = prompt.includes("[slow]")
      ? "This response is deliberately streamed slowly so cancellation can be verified without a paid API. ".repeat(
          8,
        )
      : "Deterministic fixture response. Streaming, persistence, and usage all use the production chat pipeline.";
    return sse(
      response,
      textChunks(reply),
      prompt.includes("[slow]") ? 80 : prompt.includes("[burst]") ? 1 : 18,
    );
  });
});

server.listen(port, "127.0.0.1");
