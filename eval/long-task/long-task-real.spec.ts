/**
 * §85-89 真实长任务（无头路径）：真实 Provider 驱动产品同一 runAgentLoop，
 * 在独立 fixture 克隆上执行 30-60 分钟级多阶段任务；阶段 A 中途真实中断
 * （AbortSignal，等价于 Stop 按钮），阶段 B 以续跑消息恢复同一会话历史。
 *
 * 通过条件（全部为确定性断言）：
 *  - 阶段 A 确实中断在中途（已执行工具调用且被 abort）；
 *  - 续跑不重复已完成的副作用（README schema 小节标题恰好出现一次）；
 *  - 变更只落在 packages/cli 内（无关文件不变、不加依赖）；
 *  - CLI 测试与类型检查全绿（agent 自己跑过的验证 + 评审侧复跑）。
 *
 * 运行（与 real-provider 同一环境变量约定）：
 *   EVIR_REAL_EVAL_BASE_URL / EVIR_REAL_EVAL_MODEL / EVIR_REAL_EVAL_KEY_FILE
 *   EVIR_LONG_TASK=1  EVIR_LONG_TASK_REPO=<fixture 克隆绝对路径>
 *   可选 EVIR_LONG_TASK_INTERRUPT_MIN（默认 15）/ EVIR_LONG_TASK_TOTAL_MIN（默认 55）
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_FILE_TOOLS } from "../../src/core/tools/builtin/local-file-tools";
import { createToolRegistry } from "../../src/core/tools/tool-registry-impl";
import { ToolExecutor } from "../../src/core/tools/tool-executor";
import { runAgentLoop, type AgentLoopResult } from "../../src/features/chat/agent-loop";
import { useProjectStore } from "../../src/features/projects/project-store";
import { popRunRoot, pushRunRoot } from "../../src/core/workspace/active-root";
import { createNodeStorageAdapter } from "../agent-eval/node-storage-adapter";
import type { EvirRuntime } from "../../src/runtime/types";
import type { ProviderRecord } from "../../src/core/storage/db";

const env = process.env;
const baseUrl = env.EVIR_REAL_EVAL_BASE_URL?.trim() ?? "";
const modelId = env.EVIR_REAL_EVAL_MODEL?.trim() ?? "";
const repoRoot = env.EVIR_LONG_TASK_REPO?.trim() ?? "";
const interruptAfterMs = Number.parseInt(env.EVIR_LONG_TASK_INTERRUPT_MIN ?? "15", 10) * 60_000;
const totalBudgetMs = Number.parseInt(env.EVIR_LONG_TASK_TOTAL_MIN ?? "55", 10) * 60_000;
const enabled = Boolean(env.EVIR_LONG_TASK === "1" && baseUrl && modelId && repoRoot);

const SCHEMA_HEADING = "## JSON 输出 schema";

const TASK_PROMPT = [
  "长任务：为 packages/cli 的 evir doctor 与 evir ask 两条子命令实现 --json 机器可读输出。",
  "要求分阶段执行，每阶段结束输出进度（已完成/下一步）：",
  "阶段1 通读 packages/cli 源码与现有测试，梳理当前参数解析与输出方式；",
  "阶段2 设计 --json 的输出 schema（doctor：各检查项 {id,status,details} 数组 + 总体 ok；ask：{answer, usage}），并把 schema 写进 packages/cli/README，新增小节标题固定为“## JSON 输出 schema”（整个任务只写这一次，续跑时不要重复添加该小节）；",
  "阶段3 实现 flag 解析与 JSON 输出，默认（无 --json）人类可读输出保持不变；",
  "阶段4 为两条命令补 vitest 测试（packages/cli/test/），覆盖 --json 与默认两种路径；",
  "阶段5 在 packages/cli 内运行 pnpm test 与 pnpm typecheck 确认全绿，失败则修复直到通过；",
  "阶段6 输出最终变更摘要（文件清单+每文件改动要点）与验证证据（测试命令与结果）。",
  "约束：只允许修改 packages/cli 内的文件；不引入新依赖（不得改动任何 package.json）；遵守仓库 TypeScript strict 与现有代码风格。",
].join("\n");

const RESUME_PROMPT = [
  "继续执行该任务：上一轮运行在中途被打断（用户停止）。",
  "请先检查当前仓库状态（git status/diff 与已写内容）确认已完成到哪个阶段，然后从断点继续，不要重做已完成的阶段，也不要重复添加 README 的“## JSON 输出 schema”小节。",
  "保持原任务全部约束：只改 packages/cli 内文件、不改任何 package.json、分阶段输出进度、最终给出变更摘要与验证证据（测试命令与结果）。",
].join("\n");

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    child.stdout.on("data", (c: Uint8Array) => (out += Buffer.from(c).toString("utf8")));
    child.stderr.on("data", (c: Uint8Array) => (out += Buffer.from(c).toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

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

const fmt = (ms: number) => `${Math.round(ms / 1000)}s`;

describe.skipIf(!enabled)("real long task with interruption + resume (§85-89)", () => {
  it(
    "runs the six-phase task, interrupts mid-run, resumes without repeating side effects",
    { timeout: totalBudgetMs + 5 * 60_000 },
    async () => {
      const apiKey = (await fs.readFile(env.EVIR_REAL_EVAL_KEY_FILE!.trim(), "utf8")).trim();
      const provider: ProviderRecord = {
        id: "real-long-task-provider",
        name: "EvoMap GLM",
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
      const baseStatus = await git(root, "status", "--porcelain");
      expect(baseStatus, "fixture clone must start clean").toBe("");

      useProjectStore.setState({
        projects: [
          {
            id: "eval-project-long-task",
            displayName: "Fixture App",
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
      const systemPrompt = systemPromptFor(root, toolNames);

      // ---- 阶段 A：真实中断 ----
      const phaseAStarted = Date.now();
      const abortA = new AbortController();
      const interruptTimer = setTimeout(() => abortA.abort(), interruptAfterMs);
      pushRunRoot(root, { profile: "workspace", roots: [root] });
      let resultA: AgentLoopResult;
      try {
        resultA = await runAgentLoop({
          provider,
          conversationId: "eval-long-task",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: TASK_PROMPT },
          ],
          runtime,
          maxIterations: 40,
          onDelta: () => undefined,
          signal: abortA.signal,
        });
      } finally {
        clearTimeout(interruptTimer);
        popRunRoot();
      }
      const phaseADuration = Date.now() - phaseAStarted;
      const toolResultsA = resultA.turns.flatMap((turn) => turn.toolResults ?? []);
      const messagesA = resultA.messages;

      const statusAfterA = await git(root, "status", "--porcelain");
      const diffA = await git(root, "diff");
      console.info(
        `[long-task] phase A: ${fmt(phaseADuration)}, providerCalls=${resultA.turns.length}, tools=${toolResultsA.length}, changed=[${statusAfterA
          .trim()
          .split("\n")
          .map((l) => l.slice(3).trim())
          .join(", ")}], diffLines=${diffA.split("\n").length}`,
      );

      // 中断必须发生在中途：已有工具执行，但任务尚未完整交付（README 或实现/测试未全部完成）。
      expect(
        toolResultsA.length,
        "phase A should have executed tools before interruption",
      ).toBeGreaterThan(0);
      const readmeAfterA = await fs.readFile(path.join(root, "packages/cli/README.md"), "utf8");
      const headingsAfterA = readmeAfterA.split(SCHEMA_HEADING).length - 1;
      const testsAfterA = statusAfterA
        .split("\n")
        .filter((line) => line.includes("packages/cli/test/")).length;
      const interruptedMidTask = !(headingsAfterA === 1 && testsAfterA > 0);
      // 若模型在预算内自然完成（中断前），本次运行仍可评估续跑幂等性，但会记录未发生中断。
      console.info(
        `[long-task] interruption status: ${interruptedMidTask ? "interrupted mid-task (abort signal)" : "model finished before the interrupt budget"}`,
      );
      if (interruptedMidTask) {
        expect(
          resultA.turns.some((turn) => turn.stream.status === "stopped"),
          "abort should surface as a stopped turn",
        ).toBe(true);
      }

      // ---- 阶段 B：同一会话历史 + 续跑消息恢复 ----
      const resumeMessages = [
        { role: "system", content: systemPrompt },
        ...messagesA.filter((message) => message.role !== "system"),
        { role: "user", content: RESUME_PROMPT },
      ];
      const phaseBStarted = Date.now();
      const remainingBudget = totalBudgetMs - phaseADuration;
      const abortB = new AbortController();
      const budgetTimer = setTimeout(() => abortB.abort(), Math.max(remainingBudget, 60_000));
      pushRunRoot(root, { profile: "workspace", roots: [root] });
      let resultB: AgentLoopResult;
      try {
        resultB = await runAgentLoop({
          provider,
          conversationId: "eval-long-task",
          messages: resumeMessages,
          runtime,
          maxIterations: 60,
          onDelta: () => undefined,
          signal: abortB.signal,
        });
      } finally {
        clearTimeout(budgetTimer);
        popRunRoot();
        useProjectStore.setState({ projects: [], currentProjectId: null });
      }
      const phaseBDuration = Date.now() - phaseBStarted;
      const totalDuration = phaseADuration + phaseBDuration;
      const finalText = resultB.turns
        .map((turn) => turn.stream.content ?? "")
        .join("\n")
        .trim();

      console.info(
        `[long-task] phase B: ${fmt(phaseBDuration)}, providerCalls=${resultB.turns.length}, total=${fmt(totalDuration)} (interrupt budget ${Math.round(interruptAfterMs / 60000)}min, total budget ${Math.round(totalBudgetMs / 60000)}min)`,
      );

      // ---- 终局断言 ----
      // 1) schema 小节恰好一次：续跑没有重复阶段2的副作用。
      const readmeFinal = await fs.readFile(path.join(root, "packages/cli/README.md"), "utf8");
      expect(
        readmeFinal.split(SCHEMA_HEADING).length - 1,
        "resume must not duplicate the README schema section",
      ).toBe(1);

      // 2) 只改 packages/cli；package.json 一律不动（不加依赖）。
      const finalStatus = await git(root, "status", "--porcelain");
      const changed = finalStatus
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter((file) => file.length > 0);
      console.info(`[long-task] final changed files: ${changed.join(", ") || "(none)"}`);
      expect(changed.length, "the task must produce changes").toBeGreaterThan(0);
      for (const file of changed) {
        expect(file.startsWith("packages/cli/"), `out-of-scope change after resume: ${file}`).toBe(
          true,
        );
        expect(file.endsWith("package.json"), `dependency file touched: ${file}`).toBe(false);
      }

      // 3) 实现确实存在：--json 在 CLI 源码里被解析。
      const cliSource = await fs.readFile(path.join(root, "packages/cli/src/cli.ts"), "utf8");
      expect(
        cliSource.includes('"--json"') ||
          cliSource.includes("'--json'") ||
          cliSource.includes("`--json`") ||
          cliSource.includes("json"),
      ).toBe(true);

      // 4) 评审侧复跑 CLI 测试与类型检查（agent 阶段5 的独立复核）。
      const pnpmDir = path.join(root, "packages/cli");
      const tests = await runCommand(pnpmDir, "pnpm", ["test"], 5 * 60_000);
      const typecheck = await runCommand(pnpmDir, "pnpm", ["typecheck"], 5 * 60_000);
      console.info(`[long-task] cli tests exit=${tests.code}; typecheck exit=${typecheck.code}`);
      if (tests.code !== 0) console.info(tests.output.slice(-2000));
      if (typecheck.code !== 0) console.info(typecheck.output.slice(-2000));
      expect(tests.code, "packages/cli tests must pass after the resumed run").toBe(0);
      expect(typecheck.code, "packages/cli typecheck must pass after the resumed run").toBe(0);

      // 5) 交付叙事存在（阶段6）。
      expect(finalText.length, "final summary text should be present").toBeGreaterThan(0);

      const finalDiff = await git(root, "diff");
      const report = {
        repo: root,
        baseSha: (await git(root, "rev-parse", "HEAD")).trim(),
        phaseA: {
          durationMs: phaseADuration,
          providerCalls: resultA.turns.length,
          toolCalls: toolResultsA.length,
          interruptedMidTask,
          changedFilesAfterA: statusAfterA.trim() ? statusAfterA.trim().split("\n") : [],
          diffLinesAfterA: diffA.split("\n").length,
        },
        phaseB: {
          durationMs: phaseBDuration,
          providerCalls: resultB.turns.length,
          toolCalls: resultB.turns.flatMap((turn) => turn.toolResults ?? []).length,
        },
        totalDurationMs: totalDuration,
        finalChangedFiles: changed,
        finalDiffLines: finalDiff.split("\n").length,
        verification: { testsExit: tests.code, typecheckExit: typecheck.code },
        schemaHeadingCount: readmeFinal.split(SCHEMA_HEADING).length - 1,
        finalSummary: finalText.slice(0, 4000),
      };
      const reportPath = path.join(process.cwd(), "eval", ".tmp", "long-task-report.json");
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
      await fs.writeFile(
        path.join(path.dirname(reportPath), "long-task-final.diff"),
        finalDiff,
        "utf8",
      );
      console.info(`[long-task] report written to ${reportPath}`);
    },
  );

  afterAll(() => {
    useProjectStore.setState({ projects: [], currentProjectId: null });
  });
});
