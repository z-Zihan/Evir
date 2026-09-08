/**
 * Shared scenario harness: real agent loop + real tools against a fixture
 * workspace (eval/.tmp/scenario-*). The scripted spec injects model turns
 * via vi.mock(chat-stream); the real spec lets a live model drive. No
 * streamAssistant import here so per-spec mocks shape the module graph.
 */
import { promises as fs } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProviderRecord } from "../../src/core/storage/db";
import type { EvirRuntime } from "../../src/runtime/types";
import { createToolRegistry } from "../../src/core/tools/tool-registry-impl";
import { ToolExecutor } from "../../src/core/tools/tool-executor";
import { LOCAL_FILE_TOOLS } from "../../src/core/tools/builtin/local-file-tools";
import { runAgentLoop, type AgentLoopResult } from "../../src/features/chat/agent-loop";
import { useProjectStore } from "../../src/features/projects/project-store";
import { popRunRoot, pushRunRoot } from "../../src/core/workspace/active-root";
import { candidatePathFromArgs } from "../../src/core/security/permission-profiles";
import { createNodeStorageAdapter } from "../agent-eval/node-storage-adapter";
import { outOfScopeChanges } from "../agent-eval/tasks";
import type { ScenarioTask } from "./scenario-tasks";

const MUTATING_TOOL_NAMES = new Set([
  "write_file",
  "apply_patch",
  "run_command",
  "create_directory",
]);

export interface ScenarioMetrics {
  taskSuccess: boolean;
  correctToolsSelected: boolean;
  unnecessaryToolCalls: number;
  unauthorizedOperations: number;
  outOfScopeChanges: string[];
  toolCalls: number;
  toolFailures: number;
  retries: number;
  durationMs: number;
  userInterventions: number;
  outputQuality: string;
}

export interface ScenarioRecord {
  id: string;
  category: string;
  name: string;
  pass: boolean;
  notes: string;
  metrics: ScenarioMetrics;
}

export interface ScenarioRunOptions {
  /** Substitute {{BASE_URL}} in prompts/scripts (loopback fixture server). */
  baseUrl?: string;
  maxIterations?: number;
  /** Real-tier system prompt; scripted tier uses a minimal one. */
  systemPrompt?: string;
}

async function createWorkspace(task: ScenarioTask): Promise<string> {
  const root = path.join(process.cwd(), "eval", ".tmp", `scenario-${task.id}-${process.pid}`);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const write = (relative: string, content: string) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  };
  task.setup(root, write);
  return root;
}

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

async function gitChanged(root: string): Promise<string[]> {
  const { execFile } = await import("node:child_process");
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("git", ["status", "--porcelain"], { cwd: root }, (error, out) => {
        if (error instanceof Error) reject(error);
        else if (error) reject(new Error("git status failed"));
        else resolve({ stdout: String(out) });
      });
    });
    return stdout
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter((file) => file.length > 0);
  } catch {
    return [];
  }
}

export async function runScenarioTask(
  task: ScenarioTask,
  provider: ProviderRecord,
  options: ScenarioRunOptions = {},
): Promise<ScenarioRecord> {
  const root = await createWorkspace(task);
  // Scenario workspaces are plain folders; git init makes changed-file
  // detection (out-of-scope + source-mutation checks) exact.
  const { execFile } = await import("node:child_process");
  const exec = (args: string[]) =>
    new Promise<void>((resolve) => {
      execFile("git", args, { cwd: root }, () => resolve());
    });
  await exec(["init"]);
  await exec(["config", "user.email", "eval@evir.local"]);
  await exec(["config", "user.name", "Evir Eval"]);
  await exec(["add", "."]);
  await exec(["commit", "-m", "fixture", "--no-gpg-sign", "-q"]);

  const substitute = (value: string) => value.replaceAll("{{BASE_URL}}", options.baseUrl ?? "");
  const prompt = substitute(task.prompt);

  useProjectStore.setState({
    projects: [
      {
        id: `scenario-${task.id}`,
        displayName: "Scenario Fixture",
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
  const startedAt = Date.now();
  pushRunRoot(root, { profile: "workspace", roots: [root] });
  let result: AgentLoopResult;
  try {
    result = await runAgentLoop({
      provider,
      conversationId: `scenario-${task.id}`,
      messages: [
        {
          role: "system",
          content:
            options.systemPrompt ??
            "You are Evir, a desktop agent. Complete the task using your tools.",
        },
        { role: "user", content: prompt },
      ],
      runtime,
      maxIterations: options.maxIterations ?? 16,
      onDelta: () => undefined,
    });
  } finally {
    popRunRoot();
    useProjectStore.setState({ projects: [], currentProjectId: null });
  }
  const durationMs = Date.now() - startedAt;

  const toolResults = result.turns.flatMap((turn) => turn.toolResults ?? []);
  const toolNames = toolResults.map((toolResult) => toolResult.toolName);
  const toolFailures = toolResults.filter((toolResult) => !toolResult.success).length;
  const callsById = new Map(
    result.turns.flatMap((turn) => turn.toolCalls ?? []).map((call) => [call.id, call]),
  );
  const unauthorizedOperations = toolResults.filter((toolResult) => {
    if (!toolResult.success || !MUTATING_TOOL_NAMES.has(toolResult.toolName)) return false;
    const call = callsById.get(toolResult.toolCallId);
    const raw = call ? candidatePathFromArgs(call.arguments) : null;
    if (!raw) return false;
    const resolved = raw.startsWith("/") ? raw : `${root}/${raw.replace(/^\/+/, "")}`;
    return resolved !== root && !resolved.startsWith(`${root}/`);
  }).length;

  const changed = await gitChanged(root);
  const outOfScope = outOfScopeChanges(changed, task.allowedScope);

  let firstFailureIndex = -1;
  let laterSuccessIndex = -1;
  toolResults.forEach((toolResult, index) => {
    if (!toolResult.success && firstFailureIndex === -1) firstFailureIndex = index;
    if (toolResult.success && firstFailureIndex !== -1 && laterSuccessIndex === -1) {
      laterSuccessIndex = index;
    }
  });

  const verdict = await task.evaluate({
    root,
    read: (relative) => fs.readFile(path.join(root, relative), "utf8"),
    listChanged: () => gitChanged(root),
    toolNames,
  });

  const correctToolsSelected = [...new Set(toolNames)].every((name) =>
    task.expectedTools.includes(name),
  );
  const unnecessaryToolCalls = toolNames.filter(
    (name) => !task.expectedTools.includes(name),
  ).length;

  return {
    id: task.id,
    category: task.category,
    name: task.name,
    pass: verdict.pass,
    notes: verdict.notes,
    metrics: {
      taskSuccess: verdict.pass,
      correctToolsSelected,
      unnecessaryToolCalls,
      unauthorizedOperations,
      outOfScopeChanges: outOfScope,
      toolCalls: toolResults.length,
      toolFailures,
      retries: laterSuccessIndex > firstFailureIndex ? 1 : 0,
      durationMs,
      userInterventions: 0,
      outputQuality: verdict.pass ? "meets criteria" : verdict.notes,
    },
  };
}

export async function writeScenarioReport(
  records: ScenarioRecord[],
  fileSuffix: string,
  providerMeta: Record<string, unknown>,
): Promise<string> {
  const { execFile } = await import("node:child_process");
  const commit = await new Promise<string>((resolve) => {
    execFile("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }, (_e, out) =>
      resolve(String(out).trim()),
    );
  });
  const report = {
    generatedAt: new Date().toISOString(),
    evirVersion: "0.1.0",
    commit,
    provider: providerMeta,
    summary: {
      total: records.length,
      passed: records.filter((record) => record.pass).length,
      successRate: records.length
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
      categories: [...new Set(records.map((record) => record.category))],
    },
    tasks: records,
  };
  const outDir = path.join(process.cwd(), "eval", "results");
  await fs.mkdir(outDir, { recursive: true });
  const fileName = `multi-scenario-${fileSuffix}.json`;
  await fs.writeFile(path.join(outDir, fileName), JSON.stringify(report, null, 2), "utf8");
  return path.join("eval", "results", fileName);
}
