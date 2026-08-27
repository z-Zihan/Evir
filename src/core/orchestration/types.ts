import type { Capability } from "../../runtime/types";

export type TaskRisk = "low" | "medium" | "high";
export type GoalKind = "answer" | "inspect" | "change" | "execute" | "mixed";
export type UnknownImpact =
  "non-blocking" | "scope" | "permission" | "data" | "cost" | "acceptance";

export interface Assumption {
  id: string;
  statement: string;
  source: "inferred" | "user-confirmed";
}

export interface UnknownField {
  id: string;
  question: string;
  impact: UnknownImpact;
  suggestedAnswers: string[];
  answer?: string | undefined;
}

export type DoneWhenKind = "command" | "manual";

export interface DoneWhenResult {
  label: string;
  kind: DoneWhenKind;
  status: "pending" | "passed" | "failed" | "manual" | "skipped";
  evidence: string;
}

export interface TaskBrief {
  id: string;
  runId: string;
  conversationId: string;
  goalKind: GoalKind;
  objective: string;
  constraints: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  requiredCapabilities: Capability[];
  assumptions: Assumption[];
  unknowns: UnknownField[];
  risk: TaskRisk;
  clarificationRound: number;
  version: number;
  /** Goal mode: user-stated completion conditions shown as a checklist. */
  doneWhen?: string[] | undefined;
  /** Evaluated Done-when results from the final goal verification. */
  doneWhenResults?: DoneWhenResult[] | undefined;
  createdAt: number;
  updatedAt: number;
}

export type PlanStatus =
  | "draft"
  | "awaiting_confirmation"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type NodeStatus =
  "pending" | "ready" | "running" | "blocked" | "completed" | "failed" | "skipped" | "cancelled";

export type PlanNodeKind = "task" | "subgraph" | "subagent" | "approval" | "verification" | "join";
export type EdgeCondition = "success" | "failure" | "always";
export type ResourceAccess = "read" | "write";

export interface ResourceScope {
  kind: "workspace" | "path" | "git" | "network" | "external";
  value: string;
  access: ResourceAccess;
}

export interface PlanNode {
  id: string;
  kind: PlanNodeKind;
  title: string;
  objective: string;
  dependencies: string[];
  requiredCapabilities: Capability[];
  resourceScopes: ResourceScope[];
  expectedArtifacts: string[];
  successCriteria: string[];
  status: NodeStatus;
  subgraphId?: string | undefined;
  assignmentId?: string | undefined;
  requiresApproval?: boolean | undefined;
  /** Parallel-write isolation: node executes in a dedicated git worktree. */
  isolation?: "worktree" | undefined;
}

export interface PlanEdge {
  from: string;
  to: string;
  when: EdgeCondition;
}

export interface PlanGraph {
  id: string;
  runId: string;
  conversationId: string;
  briefVersion: number;
  revision: number;
  nodes: PlanNode[];
  edges: PlanEdge[];
  status: PlanStatus;
  requiresConfirmation: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentBudget {
  maxTurns: number;
  maxDurationMs?: number | undefined;
}

export interface AgentAssignment {
  id: string;
  parentRunId: string;
  nodeId: string;
  objective: string;
  allowedTools: string[];
  resourceScopes: ResourceScope[];
  contextReferences: string[];
  expectedOutputSchema: Record<string, unknown>;
  budget: AgentBudget;
  depth: 1;
  status: "queued" | "running" | "blocked" | "completed" | "partial" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
}

export interface WorkerReport {
  assignmentId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  summary: string;
  artifacts: string[];
  verificationEvidence: string[];
  unresolvedErrors: string[];
}

export type RunEventType =
  | "run.started"
  | "intake.completed"
  | "clarification.requested"
  | "clarification.answered"
  | "plan.created"
  | "plan.confirmed"
  | "plan.revised"
  | "node.ready"
  | "node.started"
  | "node.blocked"
  | "node.completed"
  | "node.failed"
  | "node.skipped"
  | "agent.spawned"
  | "agent.completed"
  | "agent.failed"
  | "tool.pending"
  | "tool.approval-required"
  | "tool.completed"
  | "verification.completed"
  | "run.paused"
  | "run.resumed"
  | "run.partial"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.blocked"
  | "goal.verification.passed"
  | "goal.verification.failed";

export interface RunEventV1 {
  id: string;
  version: 1;
  type: RunEventType;
  runId: string;
  conversationId: string;
  nodeId?: string | undefined;
  assignmentId?: string | undefined;
  timestamp: number;
  summary: string;
  data?: Record<string, unknown> | undefined;
}

export interface OrchestrationSnapshot {
  runId: string;
  conversationId: string;
  phase:
    | "idle"
    | "intake"
    | "clarification"
    | "planning"
    | "confirmation"
    | "execution"
    | "paused"
    | "blocked"
    | "finished";
  brief: TaskBrief;
  plan?: PlanGraph | undefined;
  assignments: AgentAssignment[];
  events: RunEventV1[];
}

export interface WorkflowDefinition {
  id: string;
  version: string;
  title: string;
  nodes: Omit<PlanNode, "id" | "status">[];
  edges: Array<{ fromIndex: number; toIndex: number; when: EdgeCondition }>;
}
