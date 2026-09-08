/**
 * Multi-scenario eval — deterministic tier (§44-51): real agent loop + real
 * tools, scripted model turns, loopback fixture web server for the research
 * scenario. Zero provider quota. pnpm test:multi-scenario
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StreamResult } from "../../src/features/chat/chat-stream";
import type { ProviderRecord } from "../../src/core/storage/db";
import type { ScriptedTurn } from "../agent-eval/tasks";
import { SCENARIO_TASKS } from "./scenario-tasks";
import type { ScenarioRecord } from "./scenario-runner";

vi.mock("../../src/features/chat/chat-stream", () => ({ streamAssistant: vi.fn() }));
const { streamAssistant } = await import("../../src/features/chat/chat-stream");
const { runScenarioTask, writeScenarioReport } = await import("./scenario-runner");

const provider: ProviderRecord = {
  id: "scenario-provider",
  name: "Scripted Model",
  protocolId: "openai-chat-completions",
  baseUrl: "http://eval.invalid/v1",
  apiKey: "eval",
  modelId: "scripted-1",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

function scriptToStream(turn: ScriptedTurn, index: number): StreamResult {
  if (turn.kind === "text") {
    return { content: turn.content, status: turn.status ?? "complete" };
  }
  return {
    content: "",
    status: "complete",
    toolCalls: [
      { id: `call-${index}`, toolName: turn.toolName, arguments: JSON.stringify(turn.args) },
    ],
  };
}

/** Loopback fixture "web" with three sources that disagree on one fact. */
let server: { url: string; close: () => void } | null = null;

async function startFixtureWeb() {
  const http = await import("node:http");
  const pages: Record<string, string> = {
    "/a.md": "# 来源 A\n\n2026 年起每 4 周发布一个版本。",
    "/b.md": "# 来源 B\n\n根据我们的了解，2026 年采用 6 周发布节奏。",
    "/c.md": "# 来源 C\n\n路线图确认：4 周一个版本。",
  };
  const instance = http.createServer((request, response) => {
    const body = pages[request.url ?? ""] ?? "not found";
    response.writeHead(pages[request.url ?? ""] ? 200 : 404, { "content-type": "text/markdown" });
    response.end(body);
  });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { url, close: () => instance.close() };
}

const records: ScenarioRecord[] = [];
let reportFile = "";

beforeAll(async () => {
  server = await startFixtureWeb();
});

afterAll(async () => {
  server?.close();
  if (records.length === 0) return;
  reportFile = await writeScenarioReport(records, "scripted", {
    model: "scripted-1",
    tier: "deterministic-scripted",
  });
  const line = "\n───── Multi-scenario Eval (scripted) ─────";
  console.info(line);
  for (const record of records) {
    console.info(
      `${record.pass ? "PASS" : "FAIL"}  [${record.category}] ${record.id} — ${record.notes}`,
    );
  }
  console.info(`report: ${reportFile}`);
  console.info(`${line}\n`);
});

describe("multi-scenario golden tasks (deterministic)", () => {
  for (const task of SCENARIO_TASKS) {
    it(`${task.id} (${task.category})`, { timeout: 60_000 }, async () => {
      vi.mocked(streamAssistant).mockReset();
      const substitute = (value: string) => value.replaceAll("{{BASE_URL}}", server?.url ?? "");
      task.script.forEach((turn, index) => {
        const scripted =
          turn.kind === "tool"
            ? {
                kind: "tool" as const,
                toolName: turn.toolName,
                args: JSON.parse(substitute(JSON.stringify(turn.args))) as Record<string, unknown>,
              }
            : turn;
        vi.mocked(streamAssistant).mockResolvedValueOnce(scriptToStream(scripted, index));
      });
      const record = await runScenarioTask(
        task,
        provider,
        ...(server ? [{ baseUrl: server.url }] : []),
      );
      records.push(record);
      console.info(
        `${record.pass ? "PASS" : "FAIL"}  ${record.id} tools=${record.metrics.toolCalls} unnecessary=${record.metrics.unnecessaryToolCalls} — ${record.notes}`,
      );
      if (!record.pass) {
        expect.soft(`scenario failed: ${record.notes}`, "scenario").toBe("scenario passed");
      }
      expect.soft(record.metrics.unauthorizedOperations, "unauthorized ops").toBe(0);
      expect.soft(record.metrics.outOfScopeChanges, "out-of-scope changes").toEqual([]);
    });
  }
});
