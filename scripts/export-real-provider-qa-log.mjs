#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const valueAfter = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const dbPath = valueAfter(
  "--db",
  `${process.env.HOME}/Library/Application Support/com.zihan.evir/evir.db`,
);
const outputPath = resolve(valueAfter("--output", "artifacts/manual-qa/real-provider-run.md"));
const includeContent = args.has("--include-content");

function query(entity) {
  const sql = `SELECT data FROM app_entities WHERE entity='${entity}' ORDER BY updated_at, id`;
  const rows = JSON.parse(
    execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }) || "[]",
  );
  return rows.map(({ data }) => JSON.parse(data));
}

function redact(value) {
  return String(value ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|password|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

const conversations = query("conversations");
const messages = query("messages");
const usage = query("usage_records");
const agentRuns = query("agent_runs");
const toolExecutions = query("tool_executions");
const runEvents = query("run_events");
const lines = [
  "# Evir real-provider QA log",
  "",
  `- Exported at: ${new Date().toISOString()}`,
  `- Conversations: ${conversations.length}`,
  `- Messages: ${messages.length}`,
  `- Model requests: ${usage.length}`,
  `- Agent runs: ${agentRuns.length}`,
  `- Tool executions: ${toolExecutions.length}`,
  `- Message content included: ${includeContent ? "yes (explicit test authorization)" : "no"}`,
  "- Credentials: always redacted",
  "",
];

for (const conversation of conversations.sort((a, b) => a.createdAt - b.createdAt)) {
  const conversationMessages = messages
    .filter(({ conversationId }) => conversationId === conversation.id)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const conversationUsage = usage
    .filter(({ conversationId }) => conversationId === conversation.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const conversationRuns = agentRuns.filter(
    ({ conversationId }) => conversationId === conversation.id,
  );
  lines.push(`## ${redact(conversation.title)}`, "", `- conversation_id: ${conversation.id}`);
  lines.push(`- created_at: ${new Date(conversation.createdAt).toISOString()}`);
  lines.push(`- messages: ${conversationMessages.length}`);
  lines.push(`- model_requests: ${conversationUsage.length}`);
  lines.push(
    `- total_tokens: ${conversationUsage.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0)}`,
  );
  lines.push("");

  conversationMessages.forEach((message, index) => {
    lines.push(`### Message ${index + 1} · ${message.role}`);
    lines.push(`- created_at: ${new Date(message.createdAt).toISOString()}`);
    lines.push(`- status: ${message.status}`);
    lines.push(`- tool_calls: ${message.toolCalls?.length ?? 0}`);
    if (includeContent) lines.push("", "```text", redact(message.content), "```", "");
  });

  conversationUsage.forEach((record, index) => {
    lines.push(`### Model request ${index + 1}`);
    lines.push(`- request_id: ${record.id}`);
    lines.push(`- completed_at: ${new Date(record.createdAt).toISOString()}`);
    lines.push(`- duration_ms: ${record.durationMs}`);
    lines.push(`- first_token_ms: ${record.firstTokenMs ?? "unavailable"}`);
    lines.push(`- success: ${record.success}`);
    lines.push(`- evidence: ${record.evidence}`);
    lines.push(
      `- tokens: input=${record.inputTokens ?? "?"}, output=${record.outputTokens ?? "?"}, total=${record.totalTokens ?? "?"}`,
    );
    lines.push("");
  });

  for (const run of conversationRuns) {
    const tools = toolExecutions.filter(({ runId }) => runId === run.id);
    const events = runEvents.filter(({ runId }) => runId === run.id);
    lines.push(`### Agent run ${run.id}`);
    lines.push(`- status: ${run.status}`);
    lines.push(
      `- started_at: ${run.startedAt ? new Date(run.startedAt).toISOString() : "legacy-unavailable"}`,
    );
    lines.push(
      `- completed_at: ${run.completedAt ? new Date(run.completedAt).toISOString() : "legacy-unavailable"}`,
    );
    lines.push(`- duration_ms: ${run.durationMs ?? "legacy-unavailable"}`);
    lines.push(`- tool_executions: ${tools.length}`);
    lines.push(`- run_events: ${events.length}`);
    for (const tool of tools) {
      const result = tool.result ?? {};
      lines.push(
        `  - ${tool.toolCall?.toolName ?? "unknown"}: success=${result.success ?? false}, duration_ms=${result.durationMs ?? "legacy-unavailable"}`,
      );
    }
    lines.push("");
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(outputPath);
