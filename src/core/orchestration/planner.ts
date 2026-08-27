import { z } from "zod";
import { logger } from "../logging/logger";
import type { TaskBrief, PlanGraph, PlanNode, ResourceScope } from "./types";

export interface PlanGeneratorPort {
  generate(brief: TaskBrief, workspacePath: string | null): Promise<unknown>;
}

const draftNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["task", "subgraph", "subagent", "approval", "verification", "join"]),
    title: z.string().min(1),
    isolation: z.enum(["worktree"]).optional(),
    objective: z.string().min(1),
    dependencies: z.array(z.string()).default([]),
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
    resourceScopes: z
      .array(
        z
          .object({
            kind: z.enum(["workspace", "path", "git", "network", "external"]),
            value: z.string().min(1),
            access: z.enum(["read", "write"]),
          })
          .strict(),
      )
      .default([]),
    expectedArtifacts: z.array(z.string()).default([]),
    successCriteria: z.array(z.string()).default([]),
    subgraphId: z.string().optional(),
    requiresApproval: z.boolean().optional(),
  })
  .strict();

const draftPlanSchema = z
  .object({
    nodes: z.array(draftNodeSchema).min(1).max(50),
    edges: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            when: z.enum(["success", "failure", "always"]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

function node(
  id: string,
  title: string,
  objective: string,
  dependencies: string[],
  resourceScopes: ResourceScope[],
  overrides: Partial<PlanNode> = {},
): PlanNode {
  return {
    id,
    kind: "task",
    title,
    objective,
    dependencies,
    requiredCapabilities: [],
    resourceScopes,
    expectedArtifacts: [],
    successCriteria: [],
    status: dependencies.length === 0 ? "ready" : "pending",
    ...overrides,
  };
}

export function createPlan(brief: TaskBrief, workspacePath: string | null): PlanGraph {
  const now = Date.now();
  const workspaceRead: ResourceScope[] = workspacePath
    ? [{ kind: "workspace", value: workspacePath, access: "read" }]
    : [];
  const workspaceWrite: ResourceScope[] = workspacePath
    ? [{ kind: "workspace", value: workspacePath, access: "write" }]
    : [];
  const nodes: PlanNode[] = [];
  if (brief.goalKind === "answer") {
    nodes.push(node("respond", "Answer", brief.objective, [], []));
  } else {
    nodes.push(
      node(
        "inspect",
        "Inspect context",
        `Inspect the workspace for: ${brief.objective}`,
        [],
        workspaceRead,
        {
          requiredCapabilities: ["filesystem"],
        },
      ),
    );
    if (brief.goalKind === "change" || brief.goalKind === "execute" || brief.goalKind === "mixed") {
      nodes.push(
        node(
          "approve",
          "Confirm execution",
          "Confirm the proposed state-changing work",
          ["inspect"],
          [],
          {
            kind: "approval",
          },
        ),
        node("execute", "Execute task", brief.objective, ["approve"], workspaceWrite, {
          requiredCapabilities: brief.requiredCapabilities,
          requiresApproval: true,
          expectedArtifacts: brief.deliverables,
          successCriteria: brief.acceptanceCriteria,
        }),
        node(
          "verify",
          "Verify result",
          "Collect deterministic completion evidence",
          ["execute"],
          workspaceRead,
          {
            kind: "verification",
            requiredCapabilities: ["filesystem"],
            successCriteria: brief.acceptanceCriteria,
          },
        ),
      );
    } else {
      nodes.push(
        node("synthesize", "Synthesize findings", brief.objective, ["inspect"], [], {
          kind: "join",
        }),
        node(
          "verify",
          "Verify evidence",
          "Confirm the inspection result with observable workspace evidence",
          ["synthesize"],
          workspaceRead,
          {
            kind: "verification",
            requiredCapabilities: ["filesystem"],
            successCriteria: brief.acceptanceCriteria,
          },
        ),
      );
    }
  }
  const requiresConfirmation = planRequiresConfirmation(brief, nodes);
  return {
    id: crypto.randomUUID(),
    runId: brief.runId,
    conversationId: brief.conversationId,
    briefVersion: brief.version,
    revision: 1,
    nodes,
    edges: nodes.flatMap((current) =>
      current.dependencies.map((dependency) => ({
        from: dependency,
        to: current.id,
        when: "success" as const,
      })),
    ),
    status: requiresConfirmation ? "awaiting_confirmation" : "ready",
    requiresConfirmation,
    createdAt: now,
    updatedAt: now,
  };
}

function planRequiresConfirmation(brief: TaskBrief, nodes: readonly PlanNode[]): boolean {
  return (
    brief.risk === "high" ||
    brief.unknowns.some(({ answer }) => !answer) ||
    nodes.length > 3 ||
    nodes.some(
      (node) =>
        node.kind === "approval" ||
        node.kind === "subgraph" ||
        node.resourceScopes.some(
          ({ kind, access }) => access === "write" || kind === "network" || kind === "external",
        ),
    )
  );
}

export function confirmPlan(plan: PlanGraph): PlanGraph {
  if (plan.status !== "awaiting_confirmation") return plan;
  return { ...plan, status: "ready", updatedAt: Date.now() };
}

export async function createPlannedGraph(
  brief: TaskBrief,
  workspacePath: string | null,
  generator?: PlanGeneratorPort,
): Promise<PlanGraph> {
  if (!generator) return createPlan(brief, workspacePath);
  try {
    const draft = draftPlanSchema.parse(await generator.generate(brief, workspacePath));
    const now = Date.now();
    const nodes: PlanNode[] = draft.nodes.map((item) => ({
      ...item,
      isolation: item.isolation ?? undefined,
      requiredCapabilities: item.requiredCapabilities,
      status: item.dependencies.length === 0 ? "ready" : "pending",
    }));
    const requiresConfirmation = planRequiresConfirmation(brief, nodes);
    return {
      id: crypto.randomUUID(),
      runId: brief.runId,
      conversationId: brief.conversationId,
      briefVersion: brief.version,
      revision: 1,
      nodes,
      edges: draft.edges.length
        ? draft.edges
        : nodes.flatMap((current) =>
            current.dependencies.map((dependency) => ({
              from: dependency,
              to: current.id,
              when: "success" as const,
            })),
          ),
      status: requiresConfirmation ? "awaiting_confirmation" : "ready",
      requiresConfirmation,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    logger.warn("agent", "orchestration.model-plan-rejected", {
      runId: brief.runId,
      conversationId: brief.conversationId,
      workspacePath: workspacePath ?? null,
      reason: error instanceof Error ? error.message : String(error),
    });
    return createPlan(brief, workspacePath);
  }
}
