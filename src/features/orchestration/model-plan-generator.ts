import type { PlanGeneratorPort } from "../../core/orchestration/planner";
import type { TaskBrief } from "../../core/orchestration/types";
import type { ProviderRecord } from "../../core/storage/db";
import { streamAssistant } from "../chat/chat-stream";

const capability = [
  "chat",
  "attachments",
  "filesystem",
  "terminal",
  "git",
  "localMcp",
  "browserAutomation",
  "computerUse",
  "backgroundTasks",
];
const planTool = {
  type: "function",
  function: {
    name: "submit_plan_graph",
    description:
      "Submit a minimal deterministic DAG. Use subagents only for independent work with clear benefit.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["nodes", "edges"],
      properties: {
        nodes: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "kind",
              "title",
              "objective",
              "dependencies",
              "requiredCapabilities",
              "resourceScopes",
              "expectedArtifacts",
              "successCriteria",
            ],
            properties: {
              id: { type: "string" },
              kind: {
                type: "string",
                enum: ["task", "subgraph", "subagent", "approval", "verification", "join"],
              },
              title: { type: "string" },
              objective: { type: "string" },
              dependencies: { type: "array", items: { type: "string" } },
              requiredCapabilities: { type: "array", items: { type: "string", enum: capability } },
              resourceScopes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind", "value", "access"],
                  properties: {
                    kind: {
                      type: "string",
                      enum: ["workspace", "path", "git", "network", "external"],
                    },
                    value: { type: "string" },
                    access: { type: "string", enum: ["read", "write"] },
                  },
                },
              },
              expectedArtifacts: { type: "array", items: { type: "string" } },
              successCriteria: { type: "array", items: { type: "string" } },
              subgraphId: { type: "string" },
              requiresApproval: { type: "boolean" },
            },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "when"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              when: { type: "string", enum: ["success", "failure", "always"] },
            },
          },
        },
      },
    },
  },
};

export class ModelPlanGenerator implements PlanGeneratorPort {
  constructor(private readonly provider: ProviderRecord) {}

  async generate(brief: TaskBrief, workspacePath: string | null): Promise<unknown> {
    const stream = await streamAssistant(
      this.provider,
      brief.conversationId,
      [
        {
          role: "system",
          content:
            "Create the smallest safe execution DAG using submit_plan_graph. Writes, external sends and irreversible actions require an explicit approval node dependency; requiresApproval alone is not sufficient. Parallelize only independent read work or disjoint declared writes. End state-changing work with verification. Do not grant capabilities absent from the brief.",
        },
        {
          role: "user",
          content: JSON.stringify({
            objective: brief.objective,
            constraints: brief.constraints,
            deliverables: brief.deliverables,
            acceptanceCriteria: brief.acceptanceCriteria,
            requiredCapabilities: brief.requiredCapabilities,
            risk: brief.risk,
            workspacePath,
            builtInSubgraphs: [
              "inspect-plan-execute-verify",
              "research-synthesize",
              "change-test-diff",
              "parallel-read-join",
              "approval-action-verify",
              "failure-diagnose-retry-escalate",
            ],
          }),
        },
      ],
      () => undefined,
      [planTool],
    );
    const call = stream.toolCalls?.find(({ toolName }) => toolName === "submit_plan_graph");
    if (!call) throw new Error("Planner did not return a structured plan");
    return JSON.parse(call.arguments) as unknown;
  }
}
