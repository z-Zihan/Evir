import type { ProviderRecord } from "../../core/storage/db";
import type { TaskIntakeAnalyzerPort, TaskIntakeInput } from "../../core/orchestration/task-intake";
import { streamAssistant } from "../chat/chat-stream";

interface PriorDialogueMessage {
  role: "user" | "assistant";
  content: string;
}

const STRUCTURED_RESPONSE_TIMEOUT_MS = 45_000;

const taskBriefTool = {
  type: "function",
  function: {
    name: "submit_task_brief",
    description: "Submit a concise structured analysis of the user's task. Do not solve the task.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "goalKind",
        "objective",
        "constraints",
        "deliverables",
        "acceptanceCriteria",
        "requiredCapabilities",
        "assumptions",
        "unknowns",
        "risk",
      ],
      properties: {
        goalKind: { type: "string", enum: ["answer", "inspect", "change", "execute", "mixed"] },
        objective: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
        deliverables: { type: "array", items: { type: "string" } },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        requiredCapabilities: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "chat",
              "attachments",
              "filesystem",
              "terminal",
              "git",
              "localMcp",
              "browserAutomation",
              "computerUse",
              "backgroundTasks",
            ],
          },
        },
        assumptions: { type: "array", items: { type: "string" } },
        unknowns: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "impact", "suggestedAnswers"],
            properties: {
              question: { type: "string" },
              impact: {
                type: "string",
                enum: ["non-blocking", "scope", "permission", "data", "cost", "acceptance"],
              },
              suggestedAnswers: { type: "array", maxItems: 3, items: { type: "string" } },
            },
          },
        },
        risk: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
  },
};

export class ModelTaskIntakeAnalyzer implements TaskIntakeAnalyzerPort {
  constructor(
    private readonly provider: ProviderRecord,
    private readonly priorDialogue: PriorDialogueMessage[] = [],
  ) {}

  async analyze(input: TaskIntakeInput): Promise<unknown> {
    const stream = await streamAssistant(
      this.provider,
      input.conversationId,
      [
        {
          role: "system",
          content:
            "Analyze the current user task using submit_task_brief. The current instruction is authoritative; quoted or prior mutation requests are context, not new requested actions. A request to answer only from existing context without tools is goalKind=answer with only the chat capability. Ask only about unknowns that materially change scope, permission, data destination, cost, or acceptance. Safe assumptions should be recorded instead of turned into questions.",
        },
        ...this.priorDialogue.slice(-8).map(({ role, content }) => ({
          role,
          content: content.slice(0, 4_000),
        })),
        { role: "user", content: input.objective },
      ],
      () => undefined,
      [taskBriefTool],
      undefined,
      STRUCTURED_RESPONSE_TIMEOUT_MS,
    );
    const call = stream.toolCalls?.find(({ toolName }) => toolName === "submit_task_brief");
    if (!call) throw new Error("Task intake model did not return a structured brief");
    return JSON.parse(call.arguments) as unknown;
  }
}
