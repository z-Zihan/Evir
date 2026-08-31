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
  let closed = false;
  response.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
  const timer = setInterval(() => {
    const chunk = chunks[index++];
    if (chunk === undefined) {
      clearInterval(timer);
      if (!closed) response.end();
      return;
    }
    if (closed) return;
    response.write(`data: ${chunk}\n\n`);
  }, delay);
}

function textChunks(text) {
  // [\s\S] keeps newlines — fenced markdown artifacts must survive chunking.
  const parts = text.match(/[\s\S]{1,12}/gu) ?? [];
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

function messagesInclude(body, needle) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some(
    (message) => typeof message?.content === "string" && message.content.includes(needle),
  );
}

// Verification requests are detected on the LAST message only: nodeMessages
// always appends the node system prompt last, and prior verify summaries in
// the conversation history must not misroute later task-node turns.
function lastMessageIncludes(body, needle) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  return typeof last?.content === "string" && last.content.includes(needle);
}

// Robust node-kind discriminator: verification nodes offer the read-only tool
// set (no write tools), task nodes offer the write-capable set. Message order
// cannot be used because tool results are appended after the node system
// prompt inside a loop.
function isVerificationNodeRequest(body) {
  const names = (Array.isArray(body?.tools) ? body.tools : [])
    .map((tool) => tool?.function?.name)
    .filter(Boolean);
  return names.length > 0 && names.includes("file_stat") && !names.includes("write_file");
}

// Transient-outage injection counter; reset by restarting the fixture server.
let flakyHits = 0;

// Scripted tool-calling turns so the real agent loop (registry, permissions,
// approval, execution) can be validated against this server without a paid
// provider. The step index is derived from how many tool results the loop has
// already sent back, so the sequence survives pauses and approvals.
const AGENT_SCRIPT = [
  { tool: "list_directory", args: { path: "." } },
  { tool: "read_file", args: { path: "notes.txt" } },
  {
    tool: "write_file",
    args: {
      path: "fixture-report.md",
      content: "# Fixture report\n\nwritten by the scripted agent fixture\n",
    },
  },
  { tool: "read_file", args: { path: "fixture-report.md" } },
];

const AGENT_RECOVERY_SCRIPT = [
  { tool: "list_directory", args: { path: "." } },
  { tool: "read_file", args: { path: "missing-on-purpose.txt" } },
  {
    tool: "write_file",
    args: { path: "recovery-note.md", content: "recovered after a failed read\n" },
  },
];

const BROWSER_SCRIPT = [
  { tool: "browser_open", args: { url: "http://127.0.0.1:8765" } },
  { tool: "browser_snapshot", args: {} },
  { tool: "browser_get_text", args: {} },
  { tool: "browser_screenshot", args: {} },
  {
    tool: "write_file",
    args: {
      path: "browser-report.md",
      content: "# Browser agent report\n\nopened localhost:8765, snapshotted, screenshotted\n",
    },
  },
];

const FLAKY_SCRIPT = [
  {
    tool: "write_file",
    args: { path: "flaky-note.md", content: "written after a transient stream failure\n" },
  },
  { tool: "read_file", args: { path: "flaky-note.md" } },
];

const G2_SCRIPT = [
  {
    tool: "write_file",
    args: { path: "g2-report.md", content: "# g2 verdict end-to-end\n" },
  },
  { tool: "read_file", args: { path: "g2-report.md" } },
];

// Tag → { artifact, nodeScript, verify } for desktop orchestration runs.
// Every agent-mode send in the desktop app flows through intake → plan →
// node loops, so the fixture answers each structured protocol in turn.
const ORCH_TAGS = [
  { tag: "[agent-task]", artifact: "fixture-report.md", script: AGENT_SCRIPT, verify: "PASSED" },
  {
    tag: "[agent-recovery]",
    artifact: "recovery-note.md",
    script: AGENT_RECOVERY_SCRIPT,
    verify: "PASSED",
  },
  { tag: "[flaky-1]", artifact: "flaky-note.md", script: FLAKY_SCRIPT, flaky: 1, verify: "PASSED" },
  { tag: "[flaky-2]", artifact: "flaky-note.md", script: FLAKY_SCRIPT, flaky: 2, verify: "PASSED" },
  { tag: "[flaky-3]", artifact: "flaky-note.md", script: FLAKY_SCRIPT, flaky: 3, verify: "PASSED" },
  { tag: "[g2-pass]", artifact: "g2-report.md", script: G2_SCRIPT, verify: "PASSED" },
  { tag: "[g2-fail]", artifact: "g2-report.md", script: G2_SCRIPT, verify: "FAILED" },
  { tag: "[g2-partial]", artifact: "g2-report.md", script: G2_SCRIPT, verify: "PARTIAL" },
];

function findOrchTag(prompt) {
  return ORCH_TAGS.find(({ tag }) => prompt.includes(tag)) ?? null;
}

function toolCallChunks(id, name, args) {
  return [
    JSON.stringify({
      id: "fixture-structured-response",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    JSON.stringify({
      id: "fixture-structured-response",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 30, completion_tokens: 30, total_tokens: 60 },
    }),
    "[DONE]",
  ];
}

function intakeTurn(prompt) {
  return toolCallChunks("fixture-intake-1", "submit_task_brief", {
    goalKind: "change",
    objective: prompt,
    constraints: [],
    deliverables: ["artifact written in the project workspace"],
    acceptanceCriteria: ["artifact written and read back successfully"],
    requiredCapabilities: ["filesystem"],
    assumptions: ["fixture-driven deterministic task"],
    unknowns: [],
    risk: "low",
  });
}

function planTurn(prompt, spec) {
  // Valid plan shape per plan-validator: a write node must depend on an
  // approval node (approval boundary) and change-kind plans must end with a
  // verification node.
  const nodes = [
    {
      id: "fixture-approve",
      kind: "approval",
      title: "Confirm fixture write",
      objective: "Approve the scripted write before it runs.",
      dependencies: [],
      requiredCapabilities: ["chat"],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: ["write approved"],
    },
    {
      id: "fixture-write",
      kind: "task",
      title: "Fixture write node",
      objective: prompt,
      dependencies: ["fixture-approve"],
      requiredCapabilities: ["filesystem"],
      resourceScopes: [{ kind: "workspace", value: ".", access: "write" }],
      expectedArtifacts: [spec.artifact],
      successCriteria: [`${spec.artifact} written and read back`],
    },
    {
      id: "fixture-verify",
      kind: "verification",
      title: "Verify fixture artifact",
      objective: `Confirm ${spec.artifact} exists and matches the expected content.`,
      dependencies: ["fixture-write"],
      requiredCapabilities: ["filesystem"],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: [`${spec.artifact} present with expected content`],
    },
  ];
  const edges = [
    { from: "fixture-approve", to: "fixture-write", when: "success" },
    { from: "fixture-write", to: "fixture-verify", when: "success" },
  ];
  return toolCallChunks("fixture-plan-1", "submit_plan_graph", { nodes, edges });
}

function verifyTurn(body, spec) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const toolResults = messages.filter((message) => message?.role === "tool").length;
  if (toolResults === 0) {
    return {
      chunks: toolCallChunks("fixture-verify-tool-1", "read_file", { path: spec.artifact }),
    };
  }
  const summary =
    spec.verify === "PASSED"
      ? `${spec.artifact} exists and contains the expected heading.`
      : spec.verify === "PARTIAL"
        ? `${spec.artifact} exists but the acceptance heading is only partly present.`
        : `${spec.artifact} is missing the expected content; acceptance criteria are not met.`;
  return {
    chunks: textChunks(
      `Verification evidence collected. ${summary}\nVERIFICATION_STATUS: ${spec.verify}`,
    ),
  };
}

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

// Preview-system fixtures: multi-artifact markdown streamed through the real
// chat pipeline so CodeBlock/Preview renderers can be validated on device.
function previewArtifactReply(prompt) {
  if (prompt.includes("[preview-all]")) {
    return [
      "Here are artifacts in every preview family:\n",
      "```html\n<!DOCTYPE html>\n<html><head><style>body{font-family:sans-serif;background:#f6f8fa;padding:16px}h1{color:#0969da}</style></head>",
      '<body><h1>Hello Evir</h1><button onclick=\'document.getElementById("out").textContent="clicked"\'>Click me</button><p id=out></p></body></html>\n```\n',
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="220" height="90"><rect width="220" height="90" rx="12" fill="#5865f2"/><text x="110" y="52" text-anchor="middle" fill="white" font-size="18">Evir SVG</text></svg>\n```\n',
      "```mermaid\nflowchart TD\n  A[User asks] --> B{Tool needed?}\n  B -->|yes| C[Approval gate]\n  B -->|no| D[Direct answer]\n  C --> E[Execute + verify]\n```\n",
      "```dot\ndigraph G { rankdir=LR; a -> b -> c; a -> d; }\n```\n",
      '```json\n{"name":"evir","version":2,"features":["preview","browser"],"meta":{"local":true}}\n```\n',
      "```csv\nname,role,risk\nbrowser_open,read,L1\nbrowser_click,interact,L2\nwrite_file,mutate,L3\n```\n",
      '```vega-lite\n{"mark":"bar","data":{"values":[{"x":"A","y":28},{"x":"B","y":55},{"x":"C","y":43}]}}\n```\n',
      "```diff\n--- a/theme.css\n+++ b/theme.css\n@@ -1,3 +1,3 @@\n .btn {\n-  color: gray;\n+  color: rebeccapurple;\n }\n```\n",
      "And math: $E = mc^2$ plus a table:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    ].join("");
  }
  if (prompt.includes("[preview-stream-code]")) {
    const lines = [
      "// Streaming highlight fixture — watch tokens arrive",
      "export function fibonacci(limit) {",
      "  const out = [0, 1];",
      "  while (out.length < limit) {",
      "    out.push(out.at(-1) + out.at(-2));",
      "  }",
      "  return out;",
      "}",
      "console.log(fibonacci(10).join(', '));",
    ];
    return ["```js\n", ...lines.map((line) => `${line}\n`), "```\n"].join("");
  }
  if (prompt.includes("[preview-malformed]")) {
    return [
      "Malformed artifacts must degrade gracefully:\n",
      '```json\n{"broken": [1, 2,\n```\n',
      "```mermaid\nflowchart TD\n  A ->> > B broken syntax\n```\n",
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="4"/></svg>\n```\n',
    ].join("");
  }
  return null;
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
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    console.error(
      "[fixture] req roles:",
      messages
        .map(
          (m) =>
            `${m?.role ?? "?"}${typeof m?.content === "string" && m.content.includes("VERIFICATION_STATUS:") ? "*VERIFY*" : ""}`,
        )
        .join(","),
      "| tools:",
      (body?.tools ?? []).map((t) => t?.function?.name).join("/"),
    );
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
    // Desktop orchestration protocols: agent-mode sends run intake → plan →
    // node loops, dispatched by which tool the caller offered.
    const orch = findOrchTag(prompt);
    const offeredTools = Array.isArray(body?.tools) ? body.tools : [];
    const offered = offeredTools[0]?.function?.name ?? "";
    if (orch && offered === "submit_task_brief") {
      return sse(response, intakeTurn(prompt));
    }
    if (orch && offered === "submit_plan_graph") {
      return sse(response, planTurn(prompt, orch));
    }
    if (orch?.verify && isVerificationNodeRequest(body)) {
      return sse(response, verifyTurn(body, orch).chunks);
    }
    if (orch) {
      // Transient-failure injection counts node-loop requests only, so the
      // structured intake/plan round trips always succeed.
      if (orch.flaky) {
        flakyHits += 1;
        if (flakyHits <= orch.flaky) {
          return json(response, 503, { error: { message: "Fixture transient outage" } });
        }
      }
      const finalText = orch.verify
        ? `Task node complete: ${orch.artifact} written and read back. ${orch.tag}`
        : `Agent task complete: ${orch.artifact} written and read back. ${orch.tag}`;
      const { chunks } = scriptedToolTurn(body, orch.script, finalText);
      return sse(response, chunks);
    }
    const previewReply = previewArtifactReply(prompt);
    const reply = previewReply
      ? previewReply
      : prompt.includes("[slow]")
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

// A stray aborted SSE connection must not take the fixture down mid-test.
process.on("uncaughtException", (error) => {
  console.error("[fixture] recovered from:", error.message);
});

server.listen(port, "127.0.0.1");
