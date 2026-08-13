import { z } from "zod";

const capabilitySchema = z.enum([
  "chat",
  "attachments",
  "filesystem",
  "terminal",
  "git",
  "localMcp",
  "browserAutomation",
  "computerUse",
  "backgroundTasks",
]);

export const resourceScopeSchema = z
  .object({
    kind: z.enum(["workspace", "path", "git", "network", "external"]),
    value: z.string().min(1),
    access: z.enum(["read", "write"]),
  })
  .strict();

export const taskBriefSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    conversationId: z.string().min(1),
    goalKind: z.enum(["answer", "inspect", "change", "execute", "mixed"]),
    objective: z.string().min(1),
    constraints: z.array(z.string()),
    deliverables: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    requiredCapabilities: z.array(capabilitySchema),
    assumptions: z.array(
      z
        .object({
          id: z.string().min(1),
          statement: z.string().min(1),
          source: z.enum(["inferred", "user-confirmed"]),
        })
        .strict(),
    ),
    unknowns: z.array(
      z
        .object({
          id: z.string().min(1),
          question: z.string().min(1),
          impact: z.enum(["non-blocking", "scope", "permission", "data", "cost", "acceptance"]),
          suggestedAnswers: z.array(z.string()).max(3),
          answer: z.string().optional(),
        })
        .strict(),
    ),
    risk: z.enum(["low", "medium", "high"]),
    clarificationRound: z.number().int().min(0).max(2),
    version: z.number().int().min(1),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

export const planNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["task", "subgraph", "subagent", "approval", "verification", "join"]),
    title: z.string().min(1),
    objective: z.string().min(1),
    dependencies: z.array(z.string()),
    requiredCapabilities: z.array(capabilitySchema),
    resourceScopes: z.array(resourceScopeSchema),
    expectedArtifacts: z.array(z.string()),
    successCriteria: z.array(z.string()),
    status: z.enum([
      "pending",
      "ready",
      "running",
      "blocked",
      "completed",
      "failed",
      "skipped",
      "cancelled",
    ]),
    subgraphId: z.string().optional(),
    assignmentId: z.string().optional(),
    requiresApproval: z.boolean().optional(),
  })
  .strict();

export const planGraphSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    conversationId: z.string().min(1),
    briefVersion: z.number().int().min(1),
    revision: z.number().int().min(1),
    nodes: z.array(planNodeSchema).max(50),
    edges: z.array(
      z
        .object({
          from: z.string().min(1),
          to: z.string().min(1),
          when: z.enum(["success", "failure", "always"]),
        })
        .strict(),
    ),
    status: z.enum([
      "draft",
      "awaiting_confirmation",
      "ready",
      "running",
      "paused",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ]),
    requiresConfirmation: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

export const workerReportSchema = z
  .object({
    assignmentId: z.string().min(1),
    status: z.enum(["completed", "partial", "failed", "cancelled"]),
    summary: z.string(),
    artifacts: z.array(z.string()),
    verificationEvidence: z.array(z.string()),
    unresolvedErrors: z.array(z.string()),
  })
  .strict();

export const runEventSchema = z
  .object({
    id: z.string().min(1),
    version: z.literal(1),
    type: z.enum([
      "run.started",
      "intake.completed",
      "clarification.requested",
      "clarification.answered",
      "plan.created",
      "plan.confirmed",
      "plan.revised",
      "node.ready",
      "node.started",
      "node.blocked",
      "node.completed",
      "node.failed",
      "node.skipped",
      "agent.spawned",
      "agent.completed",
      "agent.failed",
      "tool.pending",
      "tool.approval-required",
      "tool.completed",
      "verification.completed",
      "run.paused",
      "run.resumed",
      "run.partial",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ]),
    runId: z.string().min(1),
    conversationId: z.string().min(1),
    nodeId: z.string().optional(),
    assignmentId: z.string().optional(),
    timestamp: z.number(),
    summary: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
