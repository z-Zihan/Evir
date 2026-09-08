/**
 * Multi-scenario Golden Tasks (§44-51): data analysis, web research,
 * document work, automation — beyond the coding-focused agent-eval suite.
 *
 * Each scenario runs the REAL agent loop + tools against a fixture
 * workspace; the scripted tier pins model turns (deterministic, zero
 * quota), the real tier (real-scenarios.spec.ts) lets a live model choose
 * tools. Metrics follow §51.
 */
import type { ScriptedTurn } from "../agent-eval/tasks";

export type ScenarioCategory = "data" | "web" | "document" | "automation";

export interface ScenarioTask {
  id: string;
  category: ScenarioCategory;
  name: string;
  prompt: string;
  allowedScope: string[];
  /** Tools the scenario expects to see used (others count as unnecessary). */
  expectedTools: string[];
  /** Scripted model turns for the deterministic tier. */
  script: ScriptedTurn[];
  /** Create the fixture workspace files. */
  setup: (root: string, write: (path: string, content: string) => void) => void;
  evaluate: (context: {
    root: string;
    read: (path: string) => Promise<string>;
    listChanged: () => Promise<string[]>;
    toolNames: string[];
  }) => Promise<{ pass: boolean; notes: string }>;
}

export const SCENARIO_TASKS: ScenarioTask[] = [
  {
    id: "ms-01-data-clean-aggregate",
    category: "data",
    name: "CSV 清洗 + 聚合 + 报告",
    prompt:
      "清洗 orders.csv（去除重复行与空客户名行），按客户聚合总金额，输出 results.csv（customer,total）并生成 report.md 简述结论。不要修改源数据文件。",
    allowedScope: ["results.csv", "report.md"],
    expectedTools: ["read_file", "write_file", "run_command"],
    setup: (_root, write) => {
      write(
        "orders.csv",
        [
          "customer,amount",
          "alice,120.5",
          "bob,80",
          "alice,120.5", // duplicate row
          ",45", // empty customer
          "bob,20.25",
          "carol,300",
        ].join("\n"),
      );
    },
    script: [
      { kind: "tool", toolName: "read_file", args: { path: "orders.csv" } },
      {
        kind: "tool",
        toolName: "run_command",
        args: {
          cwd: ".",
          program: "node",
          args: ["-e", "console.log('aggregation ok')"],
        },
      },
      {
        kind: "tool",
        toolName: "write_file",
        args: {
          path: "results.csv",
          content: "customer,total\nalice,120.5\nbob,100.25\ncarol,300\n",
        },
      },
      {
        kind: "tool",
        toolName: "write_file",
        args: {
          path: "report.md",
          content:
            "# 订单清洗报告\n\n去除 1 行重复与 1 行空客户名。聚合：alice=120.5，bob=100.25，carol=300。总计 520.75。\n",
        },
      },
      { kind: "text", content: "清洗完成，结果见 results.csv 与 report.md。", status: "complete" },
    ],
    evaluate: async ({ read, listChanged }) => {
      const changed = await listChanged();
      if (changed.includes("orders.csv")) {
        return { pass: false, notes: "source data mutated" };
      }
      const results = await read("results.csv");
      const report = await read("report.md").catch(() => "");
      const correctTotals =
        results.includes("alice,120.5") &&
        results.includes("bob,100.25") &&
        results.includes("carol,300");
      if (!correctTotals) return { pass: false, notes: "aggregation totals wrong" };
      if (!/orders\.csv|清洗|aggregate|total/i.test(report)) {
        return { pass: false, notes: "report missing conclusion" };
      }
      return { pass: true, notes: "cleaned, aggregated, reported; source untouched" };
    },
  },
  {
    id: "ms-02-web-research-compare",
    category: "web",
    name: "多来源网页研究 + 引用保存",
    prompt:
      "用 curl 读取 {{BASE_URL}}/a.md、{{BASE_URL}}/b.md、{{BASE_URL}}/c.md 三个来源，比较它们对 2026 年发布节奏的说法，把结论与来源链接保存到 research.md。冲突信息要注明分歧。",
    allowedScope: ["research.md"],
    expectedTools: ["run_command", "write_file"],
    setup: (_root, write) => {
      write(".placeholder", "");
    },
    script: [
      {
        kind: "tool",
        toolName: "run_command",
        args: { cwd: ".", program: "curl", args: ["{{BASE_URL}}/a.md"] },
      },
      {
        kind: "tool",
        toolName: "run_command",
        args: { cwd: ".", program: "curl", args: ["{{BASE_URL}}/b.md"] },
      },
      {
        kind: "tool",
        toolName: "run_command",
        args: { cwd: ".", program: "curl", args: ["{{BASE_URL}}/c.md"] },
      },
      {
        kind: "tool",
        toolName: "write_file",
        args: {
          path: "research.md",
          content:
            "# 发布节奏研究\n\n来源 A 与 C 认为 2026 年每 4 周一个版本；来源 B 认为 6 周。分歧已标注。\n\n- {{BASE_URL}}/a.md\n- {{BASE_URL}}/b.md\n- {{BASE_URL}}/c.md\n",
        },
      },
      { kind: "text", content: "研究完成，结论与引用已保存。", status: "complete" },
    ],
    evaluate: async ({ read }) => {
      const research = await read("research.md").catch(() => "");
      const cites = (file: string) => {
        const pattern = "({{BASE_URL}}|https?://[^ )]+)/" + file;
        return new RegExp(pattern).test(research);
      };
      if (!cites("a.md")) return { pass: false, notes: "missing citation a" };
      if (!cites("b.md")) return { pass: false, notes: "missing citation b" };
      if (!cites("c.md")) return { pass: false, notes: "missing citation c" };
      if (!/4 周|6 周|分歧|differ/i.test(research)) {
        return { pass: false, notes: "comparison/conflict not documented" };
      }
      return { pass: true, notes: "3 sources read, compared, cited" };
    },
  },
  {
    id: "ms-03-document-organize",
    category: "document",
    name: "多文档整理生成结构化摘要",
    prompt:
      "阅读 notes/ 下的三篇原始笔记，整理为一份 outline.md：保留每篇的主题标题结构，合并重复要点，结尾列出未决问题。输出进入任务产物。",
    allowedScope: ["outline.md"],
    expectedTools: ["read_file", "write_file", "report_output"],
    setup: (_root, write) => {
      write("notes/api.md", "# API 评审\n\n- 统一错误码\n- 分页游标\n- 需要限流方案（未决）");
      write(
        "notes/perf.md",
        "# 性能复盘\n\n- 列表接口 P95 下降 40%\n- 统一错误码已上线（与 api.md 重复）",
      );
      write("notes/release.md", "# 发布流程\n\n- 双环境蓝绿发布\n- 回滚演练未做（未决）");
    },
    script: [
      { kind: "tool", toolName: "read_file", args: { path: "notes/api.md" } },
      { kind: "tool", toolName: "read_file", args: { path: "notes/perf.md" } },
      { kind: "tool", toolName: "read_file", args: { path: "notes/release.md" } },
      {
        kind: "tool",
        toolName: "write_file",
        args: {
          path: "outline.md",
          content:
            "# 整理大纲\n\n## API\n- 统一错误码（与性能复盘重复，已合并）\n- 分页游标\n\n## 性能\n- P95 下降 40%\n\n## 发布\n- 蓝绿发布\n\n## 未决问题\n- 限流方案\n- 回滚演练\n",
        },
      },
      { kind: "text", content: "整理完成。", status: "complete" },
    ],
    evaluate: async ({ read, listChanged }) => {
      const changed = await listChanged();
      if (changed.some((file) => file.startsWith("notes/"))) {
        return { pass: false, notes: "source notes modified" };
      }
      const outline = await read("outline.md").catch(() => "");
      const hasStructure = /##\s/.test(outline);
      const mergedDup = /合并|merged|duplicate/i.test(outline);
      const openQuestions = /未决|open question/i.test(outline);
      if (!hasStructure) return { pass: false, notes: "structure lost" };
      if (!mergedDup) return { pass: false, notes: "duplicate points not merged" };
      if (!openQuestions) return { pass: false, notes: "open questions missing" };
      return { pass: true, notes: "structured, merged, open questions listed" };
    },
  },
  {
    id: "ms-04-automation-summarize-logs",
    category: "automation",
    name: "脚本化汇总日志并运行",
    prompt:
      "写一个 Node 脚本 summarize.mjs：统计 logs/ 下所有 .log 文件的总行数与 ERROR 行数，把脚本输出保存到 summary.txt。不要改动日志文件。",
    allowedScope: ["summarize.mjs", "summary.txt"],
    expectedTools: ["read_file", "write_file", "run_command"],
    setup: (_root, write) => {
      write(
        "logs/app.log",
        ["INFO start", "ERROR db timeout", "INFO retry", "ERROR gone"].join("\n"),
      );
      write("logs/web.log", ["INFO req", "200 ok"].join("\n"));
    },
    script: [
      { kind: "tool", toolName: "read_file", args: { path: "logs/app.log" } },
      { kind: "tool", toolName: "read_file", args: { path: "logs/web.log" } },
      {
        kind: "tool",
        toolName: "write_file",
        args: {
          path: "summarize.mjs",
          content:
            "import { readdirSync, readFileSync } from 'node:fs';\nlet lines = 0; let errors = 0;\nfor (const f of readdirSync('logs')) { if (!f.endsWith('.log')) continue; for (const l of readFileSync('logs/' + f, 'utf8').split('\\n')) { if (!l) continue; lines++; if (l.includes('ERROR')) errors++; } }\nconsole.log(`lines=${lines} errors=${errors}`);\n",
        },
      },
      {
        kind: "tool",
        toolName: "run_command",
        args: { cwd: ".", program: "node", args: ["summarize.mjs"] },
      },
      {
        kind: "tool",
        toolName: "write_file",
        args: { path: "summary.txt", content: "lines=6 errors=2\n" },
      },
      { kind: "text", content: "汇总完成。", status: "complete" },
    ],
    evaluate: async ({ read, listChanged }) => {
      const changed = await listChanged();
      if (changed.some((file) => file.startsWith("logs/"))) {
        return { pass: false, notes: "log files modified" };
      }
      const summary = await read("summary.txt").catch(() => "");
      if (!summary.includes("lines=6")) return { pass: false, notes: "total line count wrong" };
      if (!summary.includes("errors=2")) return { pass: false, notes: "error count wrong" };
      const script = await read("summarize.mjs").catch(() => "");
      if (!script.includes("readdir"))
        return { pass: false, notes: "script does not enumerate logs" };
      return { pass: true, notes: "script written, executed, correct counts" };
    },
  },
];
