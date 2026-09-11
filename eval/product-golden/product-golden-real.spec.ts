/**
 * §E3 Product-level Golden Tasks runner (real model). Five tasks run against
 * a disposable clone of Evir's real tree; every task is prepared by its
 * `setup`, executed by the same runAgentLoop the product uses, and judged by
 * deterministic `evaluate` assertions. Results (pass AND fail) are recorded
 * to eval/results/product-golden-<date>.json — honest NOT RUN when env is
 * absent, honest FAIL when assertions break.
 *
 * Env (same conventions as the other real evals):
 *   EVIR_PRODUCT_GOLDEN=1
 *   EVIR_REAL_EVAL_BASE_URL / EVIR_REAL_EVAL_MODEL / EVIR_REAL_EVAL_KEY_FILE
 *   EVIR_PRODUCT_GOLDEN_REPO=<disposable clone of this repo>
 *   EVIR_PRODUCT_GOLDEN_ONLY=<task id> to run a single task
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_FILE_TOOLS } from "../../src/core/tools/builtin/local-file-tools";
import { createToolRegistry } from "../../src/core/tools/tool-registry-impl";
import { ToolExecutor } from "../../src/core/tools/tool-executor";
import { runAgentLoop } from "../../src/features/chat/agent-loop";
import { useProjectStore } from "../../src/features/projects/project-store";
import { popRunRoot, pushRunRoot } from "../../src/core/workspace/active-root";
import { createNodeStorageAdapter } from "../agent-eval/node-storage-adapter";
import type { EvirRuntime } from "../../src/runtime/types";
import type { ProviderRecord } from "../../src/core/storage/db";
import { PRODUCT_GOLDEN_TASKS } from "./tasks";

const env = process.env;
const baseUrl = env.EVIR_REAL_EVAL_BASE_URL?.trim() ?? "";
const modelId = env.EVIR_REAL_EVAL_MODEL?.trim() ?? "";
const repoRoot = env.EVIR_PRODUCT_GOLDEN_REPO?.trim() ?? "";
const only = env.EVIR_PRODUCT_GOLDEN_ONLY?.trim() ?? "";
const enabled = Boolean(env.EVIR_PRODUCT_GOLDEN === "1" && baseUrl && modelId && repoRoot);

function runCommand(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c: Uint8Array) => (output += Buffer.from(c).toString("utf8")));
    child.stderr.on("data", (c: Uint8Array) => (output += Buffer.from(c).toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function git(cwd: string, ...args: string[]): Promise<{ code: number | null; output: string }> {
  return runCommand(cwd, "git", args, 120_000);
}

function buildRuntime(root: string): EvirRuntime {
  const toolRegistry = createToolRegistry();
  for (const tool of LOCAL_FILE_TOOLS) toolRegistry.register(tool);
  return {
    target: "desktop",
    capabilities: new Set(["chat", "filesystem", "terminal", "git"]),
    has: (capability: string) => ["chat", "filesystem", "terminal", "git"].includes(capability),
    storage: createNodeStorageAdapter(root),
    toolRegistry,
    toolExecutor: new ToolExecutor(toolRegistry),
    mode: "agent",
    getWorkspaceRoot: () => root,
  };
}

function systemPromptFor(root: string, toolNames: string): string {
  return [
    "You are Evir, a desktop coding agent working directly in a local repository.",
    `Working directory: ${root}`,
    `Available tools: ${toolNames}.`,
    "Read files before changing them, keep changes minimal and inside the repository, and verify your work by running the project's checks (run_command). Do not modify files outside the repository. When the task is done, reply with a short summary of what changed.",
  ].join("\n");
}

interface TaskResult {
  id: string;
  title: string;
  status: "pass" | "fail";
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  durationMs: number;
  toolCalls: number;
  assistantSummary: string;
}

const results: TaskResult[] = [];
const startedAt = new Date();

afterAll(async () => {
  if (!enabled) return;
  const summary = {
    suite: "product-golden-tasks",
    provider: { baseUrl, modelId, tier: "real-endpoint" },
    startedAt: startedAt.toISOString(),
    total: results.length,
    passed: results.filter((entry) => entry.status === "pass").length,
    tasks: results,
  };
  const outDir = path.join(process.cwd(), "eval", "results");
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `product-golden-${startedAt.toISOString().slice(0, 10)}.json`);
  await fs.writeFile(file, JSON.stringify(summary, null, 2), "utf8");
  console.log(`product-golden results → ${file} (${summary.passed}/${summary.total} passed)`);
});

describe.skipIf(!enabled)("product-level golden tasks (real model, §E3)", () => {
  if (!enabled) {
    it.skip("real env not configured — recorded NOT RUN", () => {});
  }
  for (const task of PRODUCT_GOLDEN_TASKS) {
    if (only && task.id !== only) continue;
    it(`${task.id}: ${task.title}`, { timeout: 30 * 60_000 }, async () => {
      const apiKey = (await fs.readFile(env.EVIR_REAL_EVAL_KEY_FILE!.trim(), "utf8")).trim();
      const provider: ProviderRecord = {
        id: "product-golden-provider",
        name: "Real endpoint",
        protocolId: "openai-compatible-chat",
        baseUrl,
        modelId,
        apiKey,
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      };
      const root = path.resolve(repoRoot);
      await fs.access(path.join(root, "packages/cli/package.json"));

      // Fresh disposable state per task.
      await git(root, "reset", "--hard");
      await git(root, "clean", "-fd");
      await task.setup(root);

      useProjectStore.setState({
        projects: [
          {
            id: `eval-project-${task.id}`,
            displayName: "Evir slice",
            nameIsCustom: false,
            rootPath: root,
            canonicalRootPath: root,
            permissionProfile: "workspace",
            additionalAccessRoots: [],
            createdAt: 1,
            updatedAt: 1,
            lastOpenedAt: 1,
          },
        ],
        currentProjectId: null,
      });

      const runtime = buildRuntime(root);
      const toolNames = (runtime.toolRegistry!.listForMode("agent") ?? [])
        .map(({ name }: { name: string }) => name)
        .join(", ");
      const started = Date.now();
      pushRunRoot(root, { profile: "workspace", roots: [root] });
      let loop;
      try {
        loop = await runAgentLoop({
          provider,
          conversationId: `product-golden-${task.id}`,
          messages: [
            { role: "system", content: systemPromptFor(root, toolNames) },
            { role: "user", content: task.prompt },
          ],
          runtime,
          maxIterations: 30,
          onDelta: () => undefined,
        });
      } finally {
        popRunRoot();
      }
      const toolCalls = loop.turns.reduce(
        (total, turn) => total + (turn.toolCalls?.length ?? 0),
        0,
      );
      const evaluation = await task.evaluate(root, runCommand);
      results.push({
        id: task.id,
        title: task.title,
        status: evaluation.pass ? "pass" : "fail",
        checks: evaluation.checks,
        durationMs: Date.now() - started,
        toolCalls,
        assistantSummary: (loop.turns.at(-1)?.stream.content ?? "").slice(0, 1_500),
      });
      // The recorded verdict is the evaluator's — never the model's summary.
      expect(
        evaluation.checks.map((check) => [check.name, check.pass]),
        `${task.id} checks:\n${evaluation.checks.map((check) => `${check.pass ? "✓" : "✗"} ${check.name}${check.detail ? ` — ${check.detail.slice(0, 300)}` : ""}`).join("\n")}`,
      ).toSatisfy((rows: Array<[string, boolean]>) => rows.every(([, pass]) => pass));
    });
  }
});
