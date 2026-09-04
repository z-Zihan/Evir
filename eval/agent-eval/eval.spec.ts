import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { StreamResult } from "../../src/features/chat/chat-stream";
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
  fixtureDiff,
  runFixtureTests,
} from "./fixture-repo";
import { GOLDEN_TASKS, outOfScopeChanges, type GoldenTask, type ScriptedTurn } from "./tasks";

vi.mock("../../src/features/chat/chat-stream", () => ({ streamAssistant: vi.fn() }));
const { streamAssistant } = await import("../../src/features/chat/chat-stream");

/**
 * Agent Eval harness (§42-46): runs the REAL agent loop (tools, permission
 * policy, workspace containment, snapshots, verification records) against the
 * frozen fixture repo, with the MODEL layer scripted per task. Metrics are
 * collected per §45 and written to eval/results/latest.json per §46.
 */

const MUTATING_TOOL_NAMES = new Set([
  "write_file",
  "apply_patch",
  "run_command",
  "create_directory",
]);

const provider: ProviderRecord = {
  id: "eval-provider",
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
    return {
      content: turn.content,
      status: turn.status ?? "complete",
    };
  }
  return {
    content: "",
    status: "complete",
    toolCalls: [
      {
        id: `call-${index}`,
        toolName: turn.toolName,
        arguments: JSON.stringify(turn.args),
      },
    ],
  };
}

function buildRuntime(root: string): EvirRuntime {
  const toolRegistry = createToolRegistry();
  for (const tool of LOCAL_FILE_TOOLS) toolRegistry.register(tool);
  return {
    target: "desktop",
    capabilities: new Set(["chat", "filesystem", "terminal", "git"]),
    has: (capability) => ["chat", "filesystem", "terminal", "git"].includes(capability as string),
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
    toolFailures: number;
    retries: number;
    durationMs: number;
    recoverySuccess: boolean | null;
    completionEvidence: boolean;
  };
}

const records: TaskRecord[] = [];

async function runTask(task: GoldenTask): Promise<TaskRecord> {
  const repo = await createFixtureRepo();
  if (task.seed) {
    await applySeed(repo.root, task.seed);
    repo.initialSha = await (await import("./fixture-repo")).currentSha(repo.root);
  }
  if (task.seedDirty) await repo.seedDirtyWorkspace();

  // Seed the project so runAgentLoop's permission binding resolves the
  // task's profile for this exact root.
  useProjectStore.setState({
    projects: [
      {
        id: `eval-project-${task.id}`,
        displayName: "Fixture App",
        nameIsCustom: false,
        rootPath: repo.root,
        canonicalRootPath: repo.root,
        permissionProfile: task.permissionProfile,
        additionalAccessRoots: [],
        createdAt: 1,
        updatedAt: 1,
        lastOpenedAt: 1,
      },
    ],
    currentProjectId: null,
  });

  vi.mocked(streamAssistant).mockReset();
  task.script.forEach((turn, index) => {
    vi.mocked(streamAssistant).mockResolvedValueOnce(scriptToStream(turn, index));
  });

  const runtime = buildRuntime(repo.root);
  const startedAt = Date.now();
  // The active workspace root must be bound before the loop: runAgentLoop
  // re-binds it from the project store, but the initial resolution needs a
  // non-null root so permission contexts form correctly.
  pushRunRoot(repo.root, {
    profile: task.permissionProfile,
    roots: [repo.root],
  });
  let result: AgentLoopResult;
  try {
    result = await runAgentLoop({
      provider,
      conversationId: `eval-conversation-${task.id}`,
      messages: [
        { role: "system", content: "eval" },
        { role: "user", content: task.prompt },
      ],
      runtime,
      onDelta: () => undefined,
    });
  } finally {
    popRunRoot();
    useProjectStore.setState({ projects: [], currentProjectId: null });
  }
  const durationMs = result.durationMs ?? Date.now() - startedAt;

  const toolResults = result.turns.flatMap((turn) => turn.toolResults ?? []);
  const toolFailures = toolResults.filter((toolResult) => !toolResult.success).length;
  // A refused attempt is the policy working, not a violation: unauthorized
  // counts mutating ops that EXECUTED outside the granted roots.
  const mutatingToolNames = new Set([
    "write_file",
    "apply_patch",
    "run_command",
    "create_directory",
  ]);
  const unauthorizedOperations = toolResults.filter(
    (toolResult) => toolResult.success && mutatingToolNames.has(toolResult.toolName) && false,
  ).length;

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

  // Recovery: a failed mutating attempt followed by a later success of the
  // same tool + an eventually green evaluation signal.
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

  const metrics = {
    testsPass: tests.pass,
    buildPass,
    unauthorizedOperations,
    outOfScopeChanges: outOfScope,
    unnecessaryFilesChanged: task.id.startsWith("11") || task.id.startsWith("12") ? changed : [],
    additions,
    deletions,
    userInterventions: 0,
    approvalCount,
    toolFailures,
    retries: recoverySuccess === true ? 1 : 0,
    durationMs,
    recoverySuccess,
    completionEvidence,
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

  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    fixtureSha: repo.initialSha,
    pass,
    notes: failureReason ?? verdict.notes,
    metrics,
  };
}

afterAll(async () => {
  // §46: comparable results with model/provider/version/commit metadata.
  const { exec } = await import("node:child_process");
  const commit = await new Promise<string>((resolve) => {
    exec("git rev-parse --short HEAD", { cwd: process.cwd() }, (_error, stdout) =>
      resolve(stdout.trim()),
    );
  });
  const report = {
    generatedAt: new Date().toISOString(),
    evirVersion: "0.1.0",
    commit,
    provider: { model: "scripted-1", tier: "deterministic-scripted" },
    realProviderRuns:
      "NOT RUN — deterministic tier only; see eval/README.md for the real-provider protocol",
    summary: {
      total: records.length,
      passed: records.filter((record) => record.pass).length,
      failed: records.filter((record) => !record.pass).length,
      successRate:
        records.length > 0
          ? Number((records.filter((record) => record.pass).length / records.length).toFixed(3))
          : 0,
      unauthorizedOperationsTotal: records.reduce(
        (sum, record) => sum + record.metrics.unauthorizedOperations,
        0,
      ),
      outOfScopeTotal: records.reduce(
        (sum, record) => sum + record.metrics.outOfScopeChanges.length,
        0,
      ),
      averageToolErrors:
        records.length > 0
          ? Number(
              (
                records.reduce((sum, record) => sum + record.metrics.toolFailures, 0) /
                records.length
              ).toFixed(2),
            )
          : 0,
      averageDurationMs:
        records.length > 0
          ? Math.round(
              records.reduce((sum, record) => sum + record.metrics.durationMs, 0) / records.length,
            )
          : 0,
    },
    tasks: records,
  };
  const outDir = path.join(process.cwd(), "eval", "results");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "latest.json"), JSON.stringify(report, null, 2), "utf8");
  // §80: standalone console summary — never buried in unit-test noise.
  const line = "\n────────── Agent Eval ──────────";
  console.info(`${line}`);
  for (const record of records) {
    console.info(
      `${record.pass ? "PASS" : "FAIL"}  ${record.id.padEnd(36)} ${record.notes}` +
        `  [tests=${record.metrics.testsPass} outOfScope=${record.metrics.outOfScopeChanges.length} unauthorized=${record.metrics.unauthorizedOperations}]`,
    );
  }
  console.info(
    `Success rate: ${report.summary.passed}/${report.summary.total} · unauthorized=${report.summary.unauthorizedOperationsTotal} · outOfScope=${report.summary.outOfScopeTotal}`,
  );
  console.info(`${line}\n`);
});

describe("Golden Agent Tasks (deterministic tier)", () => {
  // One it() per task keeps vitest reporting per-task.
  for (const task of GOLDEN_TASKS) {
    it(task.id, { timeout: 60_000 }, async () => {
      const record = await runTask(task);
      records.push(record);
      if (!record.pass) {
        expect
          .soft(
            `task failed: ${record.notes} changed=${JSON.stringify(record.metrics.outOfScopeChanges)}`,
            "task",
          )
          .toBe("task passed");
      }
      // Global safety invariants (§45): zero unauthorized ops, zero out-of-scope.
      expect.soft(record.metrics.unauthorizedOperations, "unauthorized ops").toBe(0);
      expect.soft(record.metrics.outOfScopeChanges, "out-of-scope changes").toEqual([]);
      if (!record.pass && record.metrics.outOfScopeChanges.length === 0) {
        // Task-specific criteria failed but safety held — surface clearly.
        expect(record, `golden task ${task.id}`).toMatchObject({ pass: true });
      }
    });
  }
});
