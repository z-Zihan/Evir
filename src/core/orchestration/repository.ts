import type { StorageMutation, StoragePort } from "../storage/storage-port";
import { planGraphSchema, runEventSchema, taskBriefSchema } from "./schemas";
import type {
  AgentAssignment,
  OrchestrationSnapshot,
  PlanGraph,
  RunEventV1,
  TaskBrief,
} from "./types";

export interface OrchestrationRepositoryPort {
  persistBrief(brief: TaskBrief): Promise<void>;
  persistPlan(plan: PlanGraph): Promise<void>;
  appendEvent(event: RunEventV1): Promise<void>;
  persistAssignment(assignment: AgentAssignment): Promise<void>;
  persistSnapshot(snapshot: OrchestrationSnapshot, events: RunEventV1[]): Promise<void>;
  persistPlanWithEvents(plan: PlanGraph, events: RunEventV1[]): Promise<void>;
  loadSnapshot(runId: string): Promise<OrchestrationSnapshot | undefined>;
  loadLatestSnapshotForConversation(
    conversationId: string,
  ): Promise<OrchestrationSnapshot | undefined>;
}

export class OrchestrationRepository implements OrchestrationRepositoryPort {
  constructor(private readonly storage: StoragePort) {}

  persistBrief(brief: TaskBrief): Promise<void> {
    const valid = taskBriefSchema.parse(brief);
    return this.storage.write("task_briefs", valid.id, valid);
  }

  persistPlan(plan: PlanGraph): Promise<void> {
    const valid = planGraphSchema.parse(plan);
    return this.storage.apply(this.planMutations(valid));
  }

  private planMutations(valid: PlanGraph): StorageMutation[] {
    return [
      { type: "write", entity: "plans", id: valid.id, data: valid },
      ...valid.nodes.map((step) => ({
        type: "write" as const,
        entity: "run_steps" as const,
        id: `${valid.id}:${step.id}`,
        data: { ...step, id: `${valid.id}:${step.id}`, planId: valid.id, runId: valid.runId },
      })),
    ];
  }

  appendEvent(event: RunEventV1): Promise<void> {
    const valid = runEventSchema.parse(event);
    return this.storage.write("run_events", valid.id, valid);
  }

  persistAssignment(assignment: AgentAssignment): Promise<void> {
    return this.storage.write("agent_assignments", assignment.id, assignment);
  }

  persistSnapshot(snapshot: OrchestrationSnapshot, events: RunEventV1[]): Promise<void> {
    const brief = taskBriefSchema.parse(snapshot.brief);
    const validEvents = events.map((event) => runEventSchema.parse(event));
    const mutations: StorageMutation[] = [
      ...validEvents.map((event) => ({
        type: "write" as const,
        entity: "run_events" as const,
        id: event.id,
        data: event,
      })),
      { type: "write", entity: "task_briefs", id: brief.id, data: brief },
      ...(snapshot.plan ? this.planMutations(planGraphSchema.parse(snapshot.plan)) : []),
      ...snapshot.assignments.map((assignment) => ({
        type: "write" as const,
        entity: "agent_assignments" as const,
        id: assignment.id,
        data: assignment,
      })),
    ];
    return this.storage.apply(mutations);
  }

  persistPlanWithEvents(plan: PlanGraph, events: RunEventV1[]): Promise<void> {
    const valid = planGraphSchema.parse(plan);
    const validEvents = events.map((event) => runEventSchema.parse(event));
    return this.storage.apply([
      ...validEvents.map((event) => ({
        type: "write" as const,
        entity: "run_events" as const,
        id: event.id,
        data: event,
      })),
      ...this.planMutations(valid),
    ]);
  }

  async loadSnapshot(runId: string): Promise<OrchestrationSnapshot | undefined> {
    const briefs = await this.storage.query<TaskBrief>("task_briefs", { runId });
    const brief = briefs.sort((a, b) => b.version - a.version)[0];
    if (!brief) return undefined;
    const plans = await this.storage.query<PlanGraph>("plans", { runId });
    const plan = plans.sort((a, b) => b.revision - a.revision)[0];
    const assignments = await this.storage.query<AgentAssignment>("agent_assignments", {
      parentRunId: runId,
    });
    const events = (await this.storage.query<RunEventV1>("run_events", { runId })).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const clarificationBlocked = events.some(
      ({ type, data }) => type === "run.paused" && data?.reason === "clarification-exhausted",
    );
    const recoveredPlan =
      plan?.status === "running"
        ? {
            ...plan,
            status: "paused" as const,
            nodes: plan.nodes.map((node) =>
              node.status === "running" ? { ...node, status: "blocked" as const } : node,
            ),
          }
        : plan;
    const phase = !recoveredPlan
      ? clarificationBlocked
        ? "blocked"
        : "clarification"
      : recoveredPlan.status === "paused"
        ? "paused"
        : ["completed", "partial", "failed", "cancelled"].includes(recoveredPlan.status)
          ? "finished"
          : recoveredPlan.status === "awaiting_confirmation"
            ? "confirmation"
            : "execution";
    return {
      runId,
      conversationId: brief.conversationId,
      phase,
      brief,
      ...(recoveredPlan ? { plan: recoveredPlan } : {}),
      assignments,
      events,
    };
  }

  async loadLatestSnapshotForConversation(
    conversationId: string,
  ): Promise<OrchestrationSnapshot | undefined> {
    const briefs = await this.storage.query<TaskBrief>("task_briefs", { conversationId });
    const latest = briefs.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return latest ? this.loadSnapshot(latest.runId) : undefined;
  }
}

export function createRunEvent(
  type: RunEventV1["type"],
  runId: string,
  conversationId: string,
  summary: string,
  details: Pick<RunEventV1, "nodeId" | "assignmentId" | "data"> = {},
): RunEventV1 {
  return {
    id: crypto.randomUUID(),
    version: 1,
    type,
    runId,
    conversationId,
    timestamp: Date.now(),
    summary,
    ...details,
  };
}
