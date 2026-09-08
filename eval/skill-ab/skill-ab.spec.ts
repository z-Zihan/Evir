/**
 * Skill ON/OFF A-B eval (§32): 5 core skills, each measured on a task that
 * matches its workflow — with and without the skill's method content in
 * the system prompt — using a REAL model endpoint. Metrics per §32:
 * task success, tool errors, retries, duration, verification outcome.
 *
 * Env-gated identically to the other real tiers (no config → NOT RUN).
 * Report: eval/results/skill-ab-<date>.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ProviderRecord } from "../../src/core/storage/db";
import type { ScenarioTask } from "../multi-scenario/scenario-tasks";
import type { ScenarioRecord } from "../multi-scenario/scenario-runner";

const env = process.env;
const baseUrl = env.EVIR_REAL_EVAL_BASE_URL?.trim() ?? "";
const modelId = env.EVIR_REAL_EVAL_MODEL?.trim() ?? "";
const configured = Boolean(baseUrl && modelId);

interface SkillAbPair {
  skillId: string;
  task: ScenarioTask;
}

const BASE_AGENT_PROMPT = [
  "You are Evir, a desktop coding agent working directly in a local repository.",
  'Use relative paths from the workspace root; run_command cwd ".".',
  "Verify your work by running the project's tests with run_command (node --test). Reply with a short summary when done.",
].join("\n");

function skillSection(content: string): string {
  return `\n\n<active_skills>\n${content.slice(0, 6_000)}\n</active_skills>`;
}

async function loadSkillContent(skillId: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "skills", "builtin", skillId, "SKILL.md"), "utf8");
}

const AB_PAIRS: SkillAbPair[] = [
  {
    skillId: "systematic-debugging",
    task: {
      id: "ab-debug",
      category: "data",
      name: "Systematic Debugging A/B",
      prompt: "修复当前失败的测试，并确保不改无关文件。",
      allowedScope: ["src/math.js"],
      expectedTools: ["read_file", "apply_patch", "run_command"],
      script: [],
      setup: (_root, write) => {
        write(
          "src/math.js",
          ["function divide(a, b) {", "  return a / b;", "}", "module.exports = { divide };"].join(
            "\n",
          ),
        );
        write(
          "tests/math.test.js",
          [
            "const test = require('node:test');",
            "const assert = require('node:assert');",
            "const { divide } = require('../src/math.js');",
            "test('divide reports divide-by-zero instead of Infinity', () => {",
            "  assert.strictEqual(divide(1, 0), 'cannot divide by zero');",
            "});",
          ].join("\n"),
        );
        write("package.json", JSON.stringify({ name: "ab-fixture", version: "1.0.0" }, null, 2));
      },
      evaluate: async ({ read }) => {
        const math = await read("src/math.js").catch(() => "");
        if (!/divide by zero|b === 0|b === 0/.test(math)) {
          return { pass: false, notes: "guard not added" };
        }
        return { pass: true, notes: "guard added (tests assumed run by agent)" };
      },
    },
  },
  {
    skillId: "test-driven-development",
    task: {
      id: "ab-tdd",
      category: "data",
      name: "TDD A/B",
      prompt:
        '为 src/format.js 实现 formatBytes(bytes)：1024 以下返回 "N B"，以上返回保留一位小数的 KiB；先写测试再实现，最终测试必须通过。',
      allowedScope: ["src/format.js", "tests/format.test.js"],
      expectedTools: ["write_file", "run_command"],
      script: [],
      setup: (_root, write) => {
        write("package.json", JSON.stringify({ name: "ab-fixture", version: "1.0.0" }, null, 2));
      },
      evaluate: async ({ read }) => {
        const impl = await read("src/format.js").catch(() => "");
        const test = await read("tests/format.test.js").catch(() => "");
        if (!test.includes("formatBytes")) return { pass: false, notes: "no test written" };
        if (!/formatBytes/.test(impl)) return { pass: false, notes: "no implementation" };
        return { pass: true, notes: "test + implementation present" };
      },
    },
  },
  {
    skillId: "verification-before-completion",
    task: {
      id: "ab-verify",
      category: "data",
      name: "Verification A/B",
      prompt:
        "修复 src/strings.js 中 reverse 函数的 bug（当前对空串返回 null），修完必须运行测试确认全绿再报告完成。",
      allowedScope: ["src/strings.js"],
      expectedTools: ["read_file", "apply_patch", "run_command"],
      script: [],
      setup: (_root, write) => {
        write(
          "src/strings.js",
          [
            "function reverse(value) {",
            "  if (value === null) return null;",
            '  return value.split("").reverse().join("");',
            "}",
            "module.exports = { reverse };",
          ].join("\n"),
        );
        write(
          "tests/strings.test.js",
          [
            "const test = require('node:test');",
            "const assert = require('node:assert');",
            "const { reverse } = require('../src/strings.js');",
            "test('empty string returns empty string', () => {",
            '  assert.strictEqual(reverse(""), "");',
            "});",
          ].join("\n"),
        );
        write("package.json", JSON.stringify({ name: "ab-fixture", version: "1.0.0" }, null, 2));
      },
      evaluate: async ({ read }) => {
        const source = await read("src/strings.js").catch(() => "");
        const stillBuggy =
          /if \(value === null\) return null;/.test(source) &&
          !/value[.]length === 0/.test(source) &&
          !new RegExp(["value === ", JSON.stringify("")].join("")).test(source);
        if (stillBuggy) {
          // The null branch alone still fails the empty-string test.
          return { pass: false, notes: "empty-string bug not fixed" };
        }
        if (/reverse/.test(source)) return { pass: true, notes: "fix applied" };
        return { pass: false, notes: "function lost" };
      },
    },
  },
  {
    skillId: "code-review",
    task: {
      id: "ab-review",
      category: "data",
      name: "Code Review A/B",
      prompt: "审查 src/cart.js（存在一个下标越界问题），把发现的问题与修复建议写入 review.md。",
      allowedScope: ["review.md"],
      expectedTools: ["read_file", "write_file"],
      script: [],
      setup: (_root, write) => {
        write(
          "src/cart.js",
          [
            "function itemAt(items, index) {",
            "  // No bounds check: index === items.length reads undefined downstream.",
            "  return items[index];",
            "}",
            "module.exports = { itemAt };",
          ].join("\n"),
        );
      },
      evaluate: async ({ read }) => {
        const review = await read("review.md").catch(() => "");
        if (!/越界|bounds|index|undefined/i.test(review)) {
          return { pass: false, notes: "issue not identified" };
        }
        return { pass: true, notes: "issue identified with suggestion" };
      },
    },
  },
  {
    skillId: "security-review",
    task: {
      id: "ab-security",
      category: "data",
      name: "Security Review A/B",
      prompt:
        "审查 src/login.js 中把用户输入直接拼进 shell 命令的风险，写 security.md 说明风险与安全修复方式。",
      allowedScope: ["security.md"],
      expectedTools: ["read_file", "write_file"],
      script: [],
      setup: (_root, write) => {
        write(
          "src/login.js",
          [
            "const { execSync } = require('node:child_process');",
            "function login(user) {",
            "  // Direct string interpolation into a shell command.",
            "  return execSync(`echo welcome ${user}`);",
            "}",
            "module.exports = { login };",
          ].join("\n"),
        );
      },
      evaluate: async ({ read }) => {
        const report = await read("security.md").catch(() => "");
        if (!/注入|injection|exec/i.test(report))
          return { pass: false, notes: "risk not identified" };
        if (!/参数化|数组|execFile|转义|escape|argument/i.test(report)) {
          return { pass: false, notes: "no safe alternative proposed" };
        }
        return { pass: true, notes: "injection risk + safe fix documented" };
      },
    },
  },
];

interface AbResult {
  skillId: string;
  taskId: string;
  variant: "off" | "on";
  pass: boolean;
  notes: string;
  toolCalls: number;
  toolFailures: number;
  retries: number;
  durationMs: number;
}

const results: AbResult[] = [];

const runner = configured ? describe : describe.skip;

runner("skill ON/OFF A-B eval (real provider)", () => {
  let provider: ProviderRecord;

  it("setup", async () => {
    const direct = env.EVIR_REAL_EVAL_API_KEY?.trim();
    const keyFile = env.EVIR_REAL_EVAL_KEY_FILE?.trim();
    const apiKey = direct ?? (keyFile ? (await fs.readFile(keyFile, "utf8")).trim() : "");
    expect(apiKey.length, "EVIR_REAL_EVAL_API_KEY / KEY_FILE").toBeGreaterThan(0);
    provider = {
      id: "skill-ab-provider",
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

  for (const pair of AB_PAIRS) {
    for (const variant of ["off", "on"] as const) {
      it(`${pair.skillId} [${variant.toUpperCase()}]`, { timeout: 600_000 }, async () => {
        if (!provider) throw new Error("setup must run first");
        const { runScenarioTask } = await import("../multi-scenario/scenario-runner");
        const skillContent =
          variant === "on" ? skillSection(await loadSkillContent(pair.skillId)) : "";
        const record: ScenarioRecord = await runScenarioTask(pair.task, provider, {
          maxIterations: 16,
          systemPrompt: BASE_AGENT_PROMPT + skillContent,
        });
        results.push({
          skillId: pair.skillId,
          taskId: pair.task.id,
          variant,
          pass: record.pass,
          notes: record.notes,
          toolCalls: record.metrics.toolCalls,
          toolFailures: record.metrics.toolFailures,
          retries: record.metrics.retries,
          durationMs: record.metrics.durationMs,
        });
        console.info(
          `${pair.skillId} [${variant}] ${record.pass ? "PASS" : "FAIL"} tools=${record.metrics.toolCalls} retries=${record.metrics.retries} (${Math.round(record.metrics.durationMs / 1000)}s) — ${record.notes}`,
        );
      });
    }
  }

  afterAll(async () => {
    if (results.length === 0) return;
    const { execFile } = await import("node:child_process");
    const commit = await new Promise<string>((resolve) => {
      execFile("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd() }, (_e, out) =>
        resolve(String(out).trim()),
      );
    });
    const summary = AB_PAIRS.map((pair) => {
      const off = results.find((r) => r.skillId === pair.skillId && r.variant === "off");
      const on = results.find((r) => r.skillId === pair.skillId && r.variant === "on");
      return {
        skillId: pair.skillId,
        taskId: pair.task.id,
        off: off
          ? {
              pass: off.pass,
              toolFailures: off.toolFailures,
              retries: off.retries,
              durationMs: off.durationMs,
            }
          : null,
        on: on
          ? {
              pass: on.pass,
              toolFailures: on.toolFailures,
              retries: on.retries,
              durationMs: on.durationMs,
            }
          : null,
        observation:
          off && on
            ? on.pass !== off.pass
              ? on.pass
                ? "skill helped (off failed, on passed)"
                : "skill hurt (off passed, on failed)"
              : on.toolFailures < off.toolFailures
                ? "fewer tool errors with skill"
                : on.toolFailures > off.toolFailures
                  ? "more tool errors with skill"
                  : on.durationMs < off.durationMs
                    ? "faster with skill"
                    : "comparable"
            : "incomplete",
      };
    });
    const report = {
      generatedAt: new Date().toISOString(),
      evirVersion: "0.1.0",
      commit,
      provider: { model: modelId, tier: "real-endpoint", baseUrl },
      method:
        "A/B: same task + base agent prompt; ON adds the skill's SKILL.md in <active_skills>. One sample per cell — directional signal, not a statistically significant benchmark.",
      summary,
      runs: results,
    };
    const outDir = path.join(process.cwd(), "eval", "results");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(
      path.join(outDir, `skill-ab-${new Date().toISOString().slice(0, 10)}.json`),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    const line = "\n───── Skill A/B Eval (REAL) ─────";
    console.info(line);
    for (const entry of summary) console.info(JSON.stringify(entry));
    console.info(`${line}\n`);
  });
});
