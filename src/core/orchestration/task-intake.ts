import type { Capability } from "../../runtime/types";
import { z } from "zod";
import { taskBriefSchema } from "./schemas";
import type { GoalKind, TaskBrief, UnknownField } from "./types";

export interface TaskIntakeInput {
  runId: string;
  conversationId: string;
  objective: string;
  workspacePath: string | null;
}

export interface TaskIntakeAnalyzerPort {
  analyze(input: TaskIntakeInput): Promise<unknown>;
}

const taskAnalysisSchema = z
  .object({
    goalKind: z.enum(["answer", "inspect", "change", "execute", "mixed"]),
    objective: z.string().min(1),
    constraints: z.array(z.string()).default([]),
    deliverables: z.array(z.string()).default([]),
    acceptanceCriteria: z.array(z.string()).default([]),
    requiredCapabilities: z
      .array(
        z.enum([
          "chat",
          "attachments",
          "filesystem",
          "terminal",
          "git",
          "localMcp",
          "browserAutomation",
          "computerUse",
          "backgroundTasks",
        ]),
      )
      .default([]),
    assumptions: z.array(z.string()).default([]),
    unknowns: z
      .array(
        z
          .object({
            question: z.string().min(1),
            impact: z.enum(["non-blocking", "scope", "permission", "data", "cost", "acceptance"]),
            suggestedAnswers: z.array(z.string()).max(3).default([]),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    risk: z.enum(["low", "medium", "high"]),
  })
  .strict();

const CHANGE_MARKERS = [
  "修改",
  "实现",
  "修复",
  "添加",
  "删除",
  "改造",
  "implement",
  "fix",
  "add",
  "remove",
  "change",
];
const EXECUTE_MARKERS = [
  "运行",
  "执行",
  "安装",
  "发布",
  "部署",
  "run",
  "execute",
  "install",
  "deploy",
  "publish",
];
const INSPECT_MARKERS = [
  "检查",
  "分析",
  "看看",
  "审查",
  "review",
  "inspect",
  "analyze",
  "diagnose",
];
const RISK_MARKERS = [
  "删除",
  "覆盖",
  "发布",
  "部署",
  "上传",
  "支付",
  "delete",
  "overwrite",
  "publish",
  "deploy",
  "upload",
  "payment",
];
const ACCEPTANCE_MARKERS = [
  "验收",
  "完成标准",
  "成功标准",
  "acceptance",
  "done when",
  "success criteria",
];
const VAGUE_MARKERS = [
  "优化一下",
  "处理一下",
  "弄一下",
  "改一下",
  "improve it",
  "fix it",
  "make it better",
  "handle this",
];
const CONTEXT_ONLY_ANSWER_MARKERS = [
  "只用已有上下文",
  "仅用已有上下文",
  "不要调用任何工具",
  "无需调用工具",
  "use only the existing context",
  "use only existing context",
  "do not call any tools",
  "without calling tools",
];

function includesAny(value: string, markers: string[]): boolean {
  const normalized = value.toLowerCase();
  return markers.some((marker) => {
    const candidate = marker.toLowerCase();
    if (!/^[a-z ]+$/u.test(candidate)) return normalized.includes(candidate);
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`\\b${escaped.replace(/ +/gu, "\\s+")}\\b`, "u").test(normalized);
  });
}

function goalKindOf(objective: string): GoalKind {
  if (includesAny(objective, CONTEXT_ONLY_ANSWER_MARKERS)) return "answer";
  const change = includesAny(objective, CHANGE_MARKERS);
  const execute = includesAny(objective, EXECUTE_MARKERS);
  if (change && execute) return "mixed";
  if (change) return "change";
  if (execute) return "execute";
  if (includesAny(objective, INSPECT_MARKERS)) return "inspect";
  return "answer";
}

function capabilitiesFor(kind: GoalKind): Capability[] {
  if (kind === "answer") return ["chat"];
  if (kind === "inspect") return ["chat", "filesystem"];
  if (kind === "change") return ["chat", "filesystem"];
  return ["chat", "filesystem", "terminal"];
}

function unknownsFor(input: TaskIntakeInput, kind: GoalKind): UnknownField[] {
  const unknowns: UnknownField[] = [];
  if (kind !== "answer" && !input.workspacePath) {
    unknowns.push({
      id: crypto.randomUUID(),
      question: "Which workspace should this task use?",
      impact: "permission",
      suggestedAnswers: [],
    });
  }
  if (
    (kind === "change" || kind === "execute" || kind === "mixed") &&
    !includesAny(input.objective, ACCEPTANCE_MARKERS) &&
    (input.objective.trim().length < 12 || includesAny(input.objective, VAGUE_MARKERS))
  ) {
    unknowns.push({
      id: crypto.randomUUID(),
      question: "What result should be used to verify that this task is complete?",
      impact: "acceptance",
      suggestedAnswers: [
        "Use the project's existing checks",
        "Verify the requested observable outcome",
      ],
    });
  }
  return unknowns.slice(0, 3);
}

function fallbackBrief(input: TaskIntakeInput): TaskBrief {
  const now = Date.now();
  const goalKind = goalKindOf(input.objective);
  const risk = includesAny(input.objective, RISK_MARKERS)
    ? "high"
    : goalKind === "change" || goalKind === "execute" || goalKind === "mixed"
      ? "medium"
      : "low";
  return {
    id: crypto.randomUUID(),
    runId: input.runId,
    conversationId: input.conversationId,
    goalKind,
    objective: input.objective.trim(),
    constraints: [],
    deliverables: goalKind === "answer" ? ["Answer the request"] : ["Complete the requested task"],
    acceptanceCriteria: includesAny(input.objective, ACCEPTANCE_MARKERS)
      ? ["Meet the acceptance criteria stated in the request"]
      : goalKind === "answer"
        ? []
        : ["Use the project's existing checks and verify the requested observable outcome"],
    requiredCapabilities: capabilitiesFor(goalKind),
    assumptions:
      goalKind !== "answer" && !includesAny(input.objective, ACCEPTANCE_MARKERS)
        ? [
            {
              id: crypto.randomUUID(),
              statement: "Use the project's existing checks for verification",
              source: "inferred",
            },
          ]
        : [],
    unknowns: unknownsFor(input, goalKind),
    risk,
    clarificationRound: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export class TaskIntakeService {
  constructor(private readonly analyzer?: TaskIntakeAnalyzerPort) {}

  async createBrief(input: TaskIntakeInput): Promise<TaskBrief> {
    if (!this.analyzer) return fallbackBrief(input);
    try {
      const fallback = fallbackBrief(input);
      const analyzed = taskAnalysisSchema.parse(await this.analyzer.analyze(input));
      const contextOnlyAnswer = includesAny(input.objective, CONTEXT_ONLY_ANSWER_MARKERS);
      return taskBriefSchema.parse({
        ...fallback,
        ...analyzed,
        ...(contextOnlyAnswer
          ? {
              goalKind: "answer" as const,
              requiredCapabilities: ["chat" as const],
              unknowns: [],
              risk: "low" as const,
            }
          : {}),
        requiredCapabilities: contextOnlyAnswer
          ? ["chat"]
          : analyzed.requiredCapabilities.length > 0
            ? analyzed.requiredCapabilities
            : fallback.requiredCapabilities,
        assumptions: analyzed.assumptions.map((statement) => ({
          id: crypto.randomUUID(),
          statement,
          source: "inferred" as const,
        })),
        unknowns: contextOnlyAnswer
          ? []
          : analyzed.unknowns.map((unknown) => ({ id: crypto.randomUUID(), ...unknown })),
      });
    } catch {
      return fallbackBrief(input);
    }
  }
}

export function blockingUnknowns(brief: TaskBrief): UnknownField[] {
  return brief.unknowns
    .filter(({ impact, answer }) => impact !== "non-blocking" && !answer?.trim())
    .slice(0, 3);
}

export function answerClarifications(
  brief: TaskBrief,
  answers: Readonly<Record<string, string>>,
): TaskBrief {
  if (brief.clarificationRound >= 2) return brief;
  const now = Date.now();
  return taskBriefSchema.parse({
    ...brief,
    unknowns: brief.unknowns.map((unknown) => {
      const answer = answers[unknown.id]?.trim();
      return answer ? { ...unknown, answer } : unknown;
    }),
    assumptions: [
      ...brief.assumptions,
      ...brief.unknowns.flatMap((unknown) => {
        const answer = answers[unknown.id]?.trim();
        return answer
          ? [
              {
                id: crypto.randomUUID(),
                statement: `${unknown.question} ${answer}`,
                source: "user-confirmed" as const,
              },
            ]
          : [];
      }),
    ],
    clarificationRound: brief.clarificationRound + 1,
    version: brief.version + 1,
    updatedAt: now,
  });
}
