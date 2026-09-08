/**
 * Golden Agent Tasks — REAL provider tier (§55-64, §80-84).
 *
 * Same 20 prompts + fixture + criteria as the deterministic tier, but the
 * model responses come from a real endpoint (openai-compatible streaming
 * through the production adapter) — no mocks of the model layer. The agent
 * loop, tools, permission policy, workspace containment, snapshots and
 * verification are the same real code the desktop app runs.
 *
 * Configuration (env, never logged):
 *   EVIR_REAL_EVAL_BASE_URL   e.g. https://api.example.com/v1
 *   EVIR_REAL_EVAL_API_KEY    the key itself, or EVIR_REAL_EVAL_KEY_FILE (file containing it)
 *   EVIR_REAL_EVAL_MODEL      model id on that endpoint
 *   EVIR_REAL_EVAL_PROVIDER_ID  preset id the evidence upgrades (default: zhipu)
 *   EVIR_REAL_EVAL_TASKS      "10" (first ten, default) | "20" | comma-separated task ids
 *   EVIR_REAL_EVAL_MAX_ITERATIONS  agent loop cap per task (default 24)
 *   EVIR_REAL_EVAL_UPDATE_VALIDATION=1  write qualifying evidence into
 *     src/core/providers/provider-validation.json (tier upgrade source of truth)
 *
 * Without the configuration this spec reports NOT RUN (skip) — a missing
 * quota must never become a fake PASS (§50).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ProviderRecord } from "../../src/core/storage/db";
import type { EvirRuntime } from "../../src/runtime/types";
import { createToolRegistry } from "../../src/core/tools/tool-registry-impl";
import { ToolExecutor } from "../../src/core/tools/tool-executor";
import { LOCAL_FILE_TOOLS } from "../../src/core/tools/builtin/local-file-tools";
import { runAgentLoop, type AgentLoopResult } from "../../src/features/chat/agent-loop";
import { buildAgentRunRecord } from "../../src/features/chat/agent-run-record";
import { useProjectStore } from "../../src/features/projects/project-store";
import { popRunRoot, pushRunRoot } from "../../src/core/workspace/active-root";
import { countDiffLines } from "../../src/features/workspace/changes-model";
import { candidatePathFromArgs } from "../../src/core/security/permission-profiles";
import { createNodeStorageAdapter } from "./node-storage-adapter";
import {
  applySeed,
  changedFiles,
  createFixtureRepo,
  currentSha,
  fixtureDiff,
  runFixtureTests,
} from "./fixture-repo";
import { GOLDEN_TASKS, outOfScopeChanges, type GoldenTask } from "./tasks";

const MUTATING_TOOL_NAMES = new Set([
  "write_file",
  "apply_patch",
  "run_command",
  "create_directory",
]);

const env = process.env;
const baseUrl = env.EVIR_REAL_EVAL_BASE_URL?.trim() ?? "";
const modelId = env.EVIR_REAL_EVAL_MODEL?.trim() ?? "";
const providerId = env.EVIR_REAL_EVAL_PROVIDER_ID?.trim() || "zhipu";
const maxIterations = Number.parseInt(env.EVIR_REAL_EVAL_MAX_ITERATIONS ?? "24", 10);
const updateValidation = env.EVIR_REAL_EVAL_UPDATE_VALIDATION === "1";

async function resolveApiKey(): Promise<string> {
  const direct = env.EVIR_REAL_EVAL_API_KEY?.trim();
  if (direct) return direct;
  const keyFile = env.EVIR_REAL_EVAL_KEY_FILE?.trim();
  if (keyFile) {
    const key = (await fs.readFile(keyFile, "utf8")).trim();
    if (key) return key;
  }
  return "";
}

const configured = Boolean(baseUrl && modelId);
const taskSelection = env.EVIR_REAL_EVAL_TASKS?.trim() ?? "10";
const selectedTasks: GoldenTask[] = taskSelection.includes(",")
  ? GOLDEN_TASKS.filter((task) => taskSelection.split(",").includes(task.id))
  : GOLDEN_TASKS.slice(0, Number.parseInt(taskSelection, 10) || 10);

function buildRuntime(root: string): EvirRuntime {
  const toolRegistry = createToolRegistry();
  for (const tool of LOCAL_FILE_TOOLS) toolRegistry.register(tool);
  return {
    target: "desktop",
    capabilities: new Set(["chat", "filesystem", "terminal", "git"]),
    has: (capability) => ["chat", "filesystem", "terminal", "git"].includes(capability),
    storage: createNodeStorageAdapter(root),
    toolRegistry,
    toolExecutor: new ToolExecutor(toolRegistry),
    mode: "agent",
    getWorkspaceRoot: () => root,
  };
}

interface TaskRecord {
  id: string;
  name: string;
  prompt: string;
  fixtureSha: string;
  pass: boolean;
  notes: string;
  toolSummary: string[];
  metrics: {
    testsPass: boolean;
    buildPass: boolean;
    unauthorizedOperations: number;
    outOfScopeChanges: string[];
    unnecessaryFilesChanged: string[];
    additions: number;
    deletions: number;
    userInterventions: number;
    approvalCount: number;
    toolCalls: number;
    toolFailures: number;
    retries: number;
    durationMs: number;
    recoverySuccess: boolean | null;
    completionEvidence: boolean;
    providerCalls: number;
  };
}

const records: TaskRecord[] = [];

async function runRealTask(task: GoldenTask, provider: ProviderRecord): Promise<TaskRecord> {
  const repo = await createFixtureRepo();
  if (task.seed) {
    await applySeed(repo.root, task.seed);
    repo.initialSha = await currentSha(repo.root);
  }
  if (task.seedDirty) await repo.seedDirtyWorkspace();

  // Headless deviation (recorded in the report): interactive approval tasks
  // run with the workspace profile so the loop is autonomous; the approval
  // UX itself is covered by the deterministic tier + installed-app journeys.
  const effectiveProfile = task.permissionProfile === "ask" ? "workspace" : task.permissionProfile;

  useProjectStore.setState({
    projects: [
      {
        id: `eval-project-${task.id}`,
        displayName: "Fixture App",
        nameIsCustom: false,
        rootPath: repo.root,
        canonicalRootPath: repo.root,
        permissionProfile: effectiveProfile,
        additionalAccessRoots: [],
        createdAt: 1,
        updatedAt: 1,
        lastOpenedAt: 1,
      },
    ],
    currentProjectId: null,
  });

  const runtime = buildRuntime(repo.root);
  const startedAt = Date.now();
  pushRunRoot(repo.root, { profile: effectiveProfile, roots: [repo.root] });
  // The real product always sends a system prompt describing the agent
  // environment; without it a reasoning model answers in text instead of
  // using tools. Mirror that environment (tool names + workspace root).
  const toolNames = (runtime.toolRegistry?.listForMode("agent") ?? [])
    .map(({ name }) => name)
    .join(", ");
  const systemPrompt = [
    "You are Evir, a desktop coding agent working directly in a local repository.",
    `Working directory: ${repo.root}`,
    `Available tools: ${toolNames}.`,
    "Read files before changing them, keep changes minimal and inside the repository, and verify your work by running the project's tests (run_command with cwd set to the working directory, program 'node', args ['--test']). Do not modify files outside the repository. When the task is done, reply with a short summary of what changed.",
  ].join("\n");
  let result: AgentLoopResult;
  try {
    result = await runAgentLoop({
      provider,
      conversationId: `eval-conversation-${task.id}`,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: task.prompt },
      ],
      runtime,
      maxIterations,
      onDelta: () => undefined,
    });
  } finally {
    popRunRoot();
    useProjectStore.setState({ projects: [], currentProjectId: null });
  }
  const durationMs = result.durationMs ?? Date.now() - startedAt;

  const toolResults = result.turns.flatMap((turn) => turn.toolResults ?? []);
  const toolFailures = toolResults.filter((toolResult) => !toolResult.success).length;
  const providerCalls = result.turns.length;
  const callsById = new Map(
    result.turns.flatMap((turn) => turn.toolCalls ?? []).map((call) => [call.id, call]),
  );
  const unauthorizedOperations = toolResults.filter((toolResult) => {
    if (!toolResult.success || !MUTATING_TOOL_NAMES.has(toolResult.toolName)) return false;
    const call = callsById.get(toolResult.toolCallId);
    const raw = call ? candidatePathFromArgs(call.arguments) : null;
    if (!raw) return false;
    const resolved = raw.startsWith("/") ? raw : `${repo.root}/${raw.replace(/^\/+/, "")}`;
    return resolved !== repo.root && !resolved.startsWith(`${repo.root}/`);
  }).length;

  const tests = await runFixtureTests(repo.root);
  const changed = await changedFiles(repo.root);
  const diff = await fixtureDiff(repo.root);
  const { additions, deletions } = countDiffLines(diff);

  const buildPass =
    changed.length === 0 ||
    (
      await Promise.all(
        changed
          .filter((file) => /\.(js|mjs|cjs)$/.test(file))
          .map(async (file) => {
            const proc = await import("node:child_process").then(
              ({ spawn }) =>
                new Promise<boolean>((resolve) => {
                  const child = spawn("node", ["--check", path.join(repo.root, file)]);
                  child.on("error", () => resolve(false));
                  child.on("close", (code) => resolve(code === 0));
                }),
            );
            return proc;
          }),
      )
    ).every(Boolean);

  const outOfScope = outOfScopeChanges(changed, task.allowedScope, task.ignoreInScope);
  const approvalCount =
    (result.approvalContexts?.length ?? 0) ||
    (result.turns.some((turn) => turn.pendingApproval) ? 1 : 0);

  let firstFailureIndex = -1;
  let laterSuccessIndex = -1;
  toolResults.forEach((toolResult, index) => {
    if (!toolResult.success && firstFailureIndex === -1) firstFailureIndex = index;
    if (toolResult.success && firstFailureIndex !== -1 && laterSuccessIndex === -1) {
      laterSuccessIndex = index;
    }
  });
  const recoverySuccess = firstFailureIndex === -1 ? null : laterSuccessIndex > firstFailureIndex;

  const runRecord = await buildAgentRunRecord(result, `eval-conversation-${task.id}`, runtime);
  const completionEvidence =
    runRecord.status === "completed" && runRecord.resolution.complete === true;

  const metrics: TaskRecord["metrics"] = {
    testsPass: tests.pass,
    buildPass,
    unauthorizedOperations,
    outOfScopeChanges: outOfScope,
    unnecessaryFilesChanged: task.id.startsWith("11") || task.id.startsWith("12") ? changed : [],
    additions,
    deletions,
    userInterventions: 0,
    approvalCount,
    toolCalls: toolResults.length,
    toolFailures,
    retries: recoverySuccess === true ? 1 : 0,
    durationMs,
    recoverySuccess,
    completionEvidence,
    providerCalls,
  };

  const verdict = await task.evaluate({
    result,
    repo,
    testsPass: tests.pass,
    testsOutput: tests.output,
    changed,
    metrics,
  });
  const failureReason = task.failureIf
    ? await task.failureIf({
        result,
        repo,
        testsPass: tests.pass,
        testsOutput: tests.output,
        changed,
        metrics,
      })
    : null;
  const pass = verdict.pass && failureReason === null;

  const toolSummary = result.turns.flatMap((turn) => [
    ...(turn.pendingApproval ? ["<pending-approval>"] : []),
    ...(turn.toolResults ?? []).map(
      (toolResult) =>
        `${toolResult.toolName} ${toolResult.success ? "ok" : `error:${toolResult.error ?? "?"}`}`,
    ),
  ]);
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    fixtureSha: repo.initialSha,
    pass,
    notes: failureReason ?? verdict.notes,
    toolSummary,
    metrics,
  };
}

const runner = configured ? describe : describe.skip;

runner("Golden Agent Tasks (real provider tier)", () => {
  let provider: ProviderRecord;

  it("setup: endpoint configuration resolves (no quota spent, key never logged)", async () => {
    const apiKey = await resolveApiKey();
    expect(apiKey.length, "EVIR_REAL_EVAL_API_KEY / EVIR_REAL_EVAL_KEY_FILE").toBeGreaterThan(0);
    provider = {
      id: "real-eval-provider",
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

  for (const task of selectedTasks) {
    it(task.id, { timeout: 600_000, retry: 0 }, async () => {
      if (!provider) throw new Error("setup task must run first");
      const record = await runRealTask(task, provider);
      records.push(record);
      console.info(
        `${record.pass ? "PASS" : "FAIL"}  ${record.id}  turns=${record.metrics.providerCalls} tools=${record.metrics.toolCalls} (${Math.round(record.metrics.durationMs / 1000)}s) — ${record.notes}`,
      );
      console.info(`    tools: ${record.toolSummary.join(" | ") || "(none)"}`);
      if (!record.pass) {
        expect.soft(`real-tier task failed: ${record.notes}`, "task").toBe("task passed");
      }
      expect.soft(record.metrics.unauthorizedOperations, "unauthorized ops").toBe(0);
      expect.soft(record.metrics.outOfScopeChanges, "out-of-scope changes").toEqual([]);
    });
  }

  afterAll(async () => {
    if (records.length === 0) return;
    const { exec } = await import("node:child_process");
    const commit = await new Promise<string>((resolve) => {
      exec("git rev-parse --short HEAD", { cwd: process.cwd() }, (_error, stdout) =>
        resolve(stdout.trim()),
      );
    });
    const totalToolCalls = records.reduce((sum, record) => sum + record.metrics.toolCalls, 0);
    const totalToolFailures = records.reduce((sum, record) => sum + record.metrics.toolFailures, 0);
    const summary = {
      total: records.length,
      passed: records.filter((record) => record.pass).length,
      failed: records.filter((record) => !record.pass).length,
      successRate: Number(
        (records.filter((record) => record.pass).length / records.length).toFixed(3),
      ),
      unauthorizedOperationsTotal: records.reduce(
        (sum, record) => sum + record.metrics.unauthorizedOperations,
        0,
      ),
      outOfScopeTotal: records.reduce(
        (sum, record) => sum + record.metrics.outOfScopeChanges.length,
        0,
      ),
      toolCallSuccess:
        totalToolCalls > 0 ? Number((1 - totalToolFailures / totalToolCalls).toFixed(3)) : 0,
      averageToolErrors: records.length
        ? Number((totalToolFailures / records.length).toFixed(2))
        : 0,
      averageDurationMs: Math.round(
        records.reduce((sum, record) => sum + record.metrics.durationMs, 0) / records.length,
      ),
    };
    const report = {
      generatedAt: new Date().toISOString(),
      evirVersion: "0.1.0",
      commit,
      provider: {
        // Never the key — endpoint identity only.
        baseUrl,
        model: modelId,
        providerId,
        tier: "real-endpoint",
        protocol: "openai-compatible-chat",
        headlessDeviation: "ask-profile tasks ran as workspace (no interactive approvals)",
      },
      summary,
      tasks: records,
    };
    const outDir = path.join(process.cwd(), "eval", "results");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(
      path.join(outDir, `real-${new Date().toISOString().slice(0, 10)}.json`),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(outDir, "real-latest.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );

    const qualifies =
      summary.total >= 10 &&
      summary.successRate >= 0.8 &&
      summary.toolCallSuccess >= 0.8 &&
      summary.unauthorizedOperationsTotal === 0 &&
      summary.outOfScopeTotal === 0;
    if (updateValidation) {
      const validationPath = path.join(
        process.cwd(),
        "src",
        "core",
        "providers",
        "provider-validation.json",
      );
      const validation = JSON.parse(await fs.readFile(validationPath, "utf8")) as {
        version: number;
        note?: string;
        entries: unknown[];
      };
      const entry = {
        providerId,
        modelId,
        protocol: "openai-compatible-chat",
        testedAt: report.generatedAt,
        evirCommit: commit,
        evalSuiteVersion: "agent-eval-v1",
        taskCount: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        successRate: summary.successRate,
        toolCallSuccess: summary.toolCallSuccess,
        unauthorizedOperations: summary.unauthorizedOperationsTotal,
        outOfScopeChanges: summary.outOfScopeTotal,
      };
      const existing = (validation.entries as { providerId: string }[]).filter(
        (item) => item.providerId !== providerId,
      );
      if (qualifies) {
        validation.entries = [...existing, entry];
      }
      await fs.writeFile(validationPath, JSON.stringify(validation, null, 2) + "\n", "utf8");
      console.info(
        qualifies
          ? `provider-validation.json updated: ${providerId} agent-verified evidence recorded`
          : `provider-validation.json unchanged: run did not qualify (see thresholds in provider-tiers.ts)`,
      );
    }

    const line = "\n───── Agent Eval (REAL provider tier) ─────";
    console.info(line);
    for (const record of records) {
      console.info(
        `${record.pass ? "PASS" : "FAIL"}  ${record.id.padEnd(36)} ${record.notes}` +
          `  [tests=${record.metrics.testsPass} outOfScope=${record.metrics.outOfScopeChanges.length} unauthorized=${record.metrics.unauthorizedOperations}]`,
      );
    }
    console.info(
      `Success rate: ${summary.passed}/${summary.total} · toolCallSuccess=${summary.toolCallSuccess} · unauthorized=${summary.unauthorizedOperationsTotal} · outOfScope=${summary.outOfScopeTotal}`,
    );
    console.info(`${line}\n`);
  });
});
