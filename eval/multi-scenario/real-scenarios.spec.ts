/**
 * Multi-scenario eval — REAL provider tier (§90): one real-model run per
 * non-coding category (data / web / document / automation) proving the
 * Skill+Tool+Context composition works with a live model. Env-gated like
 * the coding real tier; NOT RUN without configuration (no fake PASS).
 *
 *   EVIR_REAL_EVAL_BASE_URL / EVIR_REAL_EVAL_API_KEY|KEY_FILE /
 *   EVIR_REAL_EVAL_MODEL  — same vars as eval/agent-eval/real-provider.spec.ts
 *   EVIR_REAL_SCENARIOS   — comma list or "all" (default all)
 */
import { promises as fs } from "node:fs";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderRecord } from "../../src/core/storage/db";
import { SCENARIO_TASKS } from "./scenario-tasks";
import type { ScenarioRecord } from "./scenario-runner";

const env = process.env;
const baseUrl = env.EVIR_REAL_EVAL_BASE_URL?.trim() ?? "";
const modelId = env.EVIR_REAL_EVAL_MODEL?.trim() ?? "";
const configured = Boolean(baseUrl && modelId);
const selection = (env.EVIR_REAL_SCENARIOS?.trim() ?? "all")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const tasks = SCENARIO_TASKS.filter(
  (task) => selection.includes("all") || selection.includes(task.id),
);

const records: ScenarioRecord[] = [];
let server: { url: string; close: () => void } | null = null;
let reportFile = "";

const runner = configured ? describe : describe.skip;

async function startFixtureWeb() {
  const pages: Record<string, string> = {
    "/a.md": "# 来源 A\n\n2026 年起每 4 周发布一个版本。",
    "/b.md": "# 来源 B\n\n根据我们的了解，2026 年采用 6 周发布节奏。",
    "/c.md": "# 来源 C\n\n路线图确认：4 周一个版本。",
  };
  const instance = http.createServer((request, response) => {
    const body = pages[request.url ?? ""] ?? "not found";
    response.writeHead(pages[request.url ?? ""] ? 200 : 404, {
      "content-type": "text/markdown",
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { url, close: () => instance.close() };
}

runner("multi-scenario golden tasks (real provider tier)", () => {
  let provider: ProviderRecord;

  beforeAll(async () => {
    server = await startFixtureWeb();
    const direct = env.EVIR_REAL_EVAL_API_KEY?.trim();
    const keyFile = env.EVIR_REAL_EVAL_KEY_FILE?.trim();
    const apiKey = direct ?? (keyFile ? (await fs.readFile(keyFile, "utf8")).trim() : "");
    expect(apiKey.length, "EVIR_REAL_EVAL_API_KEY / KEY_FILE").toBeGreaterThan(0);
    provider = {
      id: "real-scenario-provider",
      name: "Real Eval Provider",
      protocolId: "openai-compatible-chat",
      baseUrl,
      apiKey,
      modelId,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };
  });

  afterAll(async () => {
    server?.close();
    if (records.length === 0) return;
    const { writeScenarioReport } = await import("./scenario-runner");
    reportFile = await writeScenarioReport(records, "real", {
      model: modelId,
      tier: "real-endpoint",
      baseUrl,
      note: "web scenario uses the loopback fixture server; research flow is real",
    });
    const line = "\n───── Multi-scenario Eval (REAL) ─────";
    console.info(line);
    for (const record of records) {
      console.info(
        `${record.pass ? "PASS" : "FAIL"}  [${record.category}] ${record.id} tools=${record.metrics.toolCalls} unnecessary=${record.metrics.unnecessaryToolCalls} — ${record.notes}`,
      );
    }
    console.info(`report: ${reportFile}`);
    console.info(`${line}\n`);
  });

  for (const task of tasks) {
    it(`${task.id} (${task.category}, real model)`, { timeout: 600_000 }, async () => {
      const { runScenarioTask } = await import("./scenario-runner");
      const { LOCAL_FILE_TOOLS } = await import("../../src/core/tools/builtin/local-file-tools");
      const toolNames = LOCAL_FILE_TOOLS.map(({ name }) => name).join(", ");
      const record = await runScenarioTask(task, provider, {
        ...(server ? { baseUrl: server.url } : {}),
        maxIterations: 20,
        systemPrompt: [
          "You are Evir, a desktop agent working in a local workspace.",
          `Workspace: use relative paths from the task root; run_command cwd ".".`,
          `Available tools: ${toolNames}.`,
          "Read inputs before producing outputs, never modify source data files unless asked, and keep outputs within the files the task names. For web sources use run_command with curl.",
        ].join("\n"),
      });
      records.push(record);
      console.info(`${record.pass ? "PASS" : "FAIL"}  ${record.id} — ${record.notes}`);
      if (!record.pass) {
        expect.soft(`real scenario failed: ${record.notes}`, "scenario").toBe("scenario passed");
      }
      expect.soft(record.metrics.unauthorizedOperations, "unauthorized ops").toBe(0);
      expect.soft(record.metrics.outOfScopeChanges, "out-of-scope changes").toEqual([]);
    });
  }
});
