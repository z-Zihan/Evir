import {
  blockingUnknowns,
  answerClarifications,
  TaskIntakeService,
} from "../../core/orchestration/task-intake";
import {
  confirmPlan,
  createPlan,
  createPlannedGraph,
  type PlanGeneratorPort,
} from "../../core/orchestration/planner";
import { validatePlanGraph, validatePlanRevision } from "../../core/orchestration/plan-validator";
import { createRunEvent, OrchestrationRepository } from "../../core/orchestration/repository";
import type { OrchestrationSnapshot, PlanGraph, RunEventV1 } from "../../core/orchestration/types";
import type { EvirRuntime } from "../../runtime/types";
import { useOrchestrationStore } from "./orchestration-store";
import type { TaskIntakeAnalyzerPort } from "../../core/orchestration/task-intake";
import { cancelOrchestration, pauseOrchestration } from "./run-orchestrated-agent";

export type PreparationResult =
  "not-applicable" | "cancelled" | "blocked" | "clarification" | "confirmation" | "ready";

const cancelledPreparations = new Set<string>();

export function cancelTaskPreparation(conversationId: string): void {
  cancelledPreparations.add(conversationId);
  useOrchestrationStore.getState().setPreparing(null);
}

async function persist(
  repository: OrchestrationRepository,
  snapshot: OrchestrationSnapshot,
  privateSession: boolean,
  events: RunEventV1[],
): Promise<void> {
  if (privateSession) return;
  await repository.persistSnapshot(snapshot, events);
}

function workflowIds(runtime: EvirRuntime): Set<string> {
  return new Set(runtime.workflowRegistry?.list().map(({ id }) => id) ?? []);
}

function assertPlan(plan: PlanGraph, runtime: EvirRuntime, requireVerification = false): void {
  const validation = validatePlanGraph(plan, {
    capabilities: runtime.capabilities,
    workflowIds: workflowIds(runtime),
    ...(runtime.workflowRegistry ? { workflows: runtime.workflowRegistry.list() } : {}),
    requireVerification,
  });
  if (!validation.valid)
    throw new Error(`Invalid orchestration plan: ${validation.errors.join(", ")}`);
}

async function buildValidatedPlan(
  brief: OrchestrationSnapshot["brief"],
  workspace: string | null,
  runtime: EvirRuntime,
  planner?: PlanGeneratorPort,
): Promise<PlanGraph> {
  const generated = await createPlannedGraph(brief, workspace, planner);
  try {
    assertPlan(generated, runtime, brief.goalKind !== "answer");
    const allowed = new Set(["chat", ...brief.requiredCapabilities]);
    if (
      generated.nodes.some((node) =>
        node.requiredCapabilities.some((capability) => !allowed.has(capability)),
      )
    ) {
      throw new Error("Generated plan expanded task capabilities");
    }
    return generated;
  } catch {
    const fallback = createPlan(brief, workspace);
    assertPlan(fallback, runtime, brief.goalKind !== "answer");
    return fallback;
  }
}

export async function prepareTask(input: {
  objective: string;
  conversationId: string;
  runtime: EvirRuntime;
  privateSession: boolean;
  analyzer?: TaskIntakeAnalyzerPort;
  planner?: PlanGeneratorPort;
}): Promise<PreparationResult> {
  if (input.runtime.target !== "desktop") return "not-applicable";
  useOrchestrationStore.getState().setPreparing({
    conversationId: input.conversationId,
    objective: input.objective,
    stage: "intake",
    startedAt: Date.now(),
  });
  try {
    cancelledPreparations.delete(input.conversationId);
    const runId = crypto.randomUUID();
    const repository = new OrchestrationRepository(input.runtime.structuredStorage!);
    const start = createRunEvent("run.started", runId, input.conversationId, "Task intake started");
    const brief = await new TaskIntakeService(input.analyzer).createBrief({
      runId,
      conversationId: input.conversationId,
      objective: input.objective,
      workspacePath: input.runtime.getWorkspaceRoot?.() ?? null,
    });
    const intake = createRunEvent(
      "intake.completed",
      runId,
      input.conversationId,
      "Task brief created",
    );
    if (cancelledPreparations.delete(input.conversationId)) {
      const cancelled = createRunEvent(
        "run.cancelled",
        runId,
        input.conversationId,
        "Task cancelled during intake",
      );
      const snapshot: OrchestrationSnapshot = {
        runId,
        conversationId: input.conversationId,
        phase: "finished",
        brief,
        assignments: [],
        events: [start, intake, cancelled],
      };
      await persist(repository, snapshot, input.privateSession, snapshot.events);
      useOrchestrationStore.getState().setCurrent(snapshot);
      useOrchestrationStore.getState().setPreparing(null);
      return "cancelled";
    }
    const blocking = blockingUnknowns(brief);
    if (blocking.length > 0) {
      const clarification = createRunEvent(
        "clarification.requested",
        runId,
        input.conversationId,
        `${blocking.length} clarification questions required`,
      );
      const snapshot: OrchestrationSnapshot = {
        runId,
        conversationId: input.conversationId,
        phase: "clarification",
        brief,
        assignments: [],
        events: [start, intake, clarification],
      };
      await persist(repository, snapshot, input.privateSession, snapshot.events);
      useOrchestrationStore.getState().setCurrent(snapshot);
      useOrchestrationStore.getState().setPreparing(null);
      return "clarification";
    }
    useOrchestrationStore.getState().setPreparationStage(input.conversationId, "planning");
    const plan = await buildValidatedPlan(
      brief,
      input.runtime.getWorkspaceRoot?.() ?? null,
      input.runtime,
      input.planner,
    );
    const planEvent = createRunEvent(
      "plan.created",
      runId,
      input.conversationId,
      "Execution plan created",
    );
    const phase = plan.requiresConfirmation ? "confirmation" : "execution";
    const snapshot: OrchestrationSnapshot = {
      runId,
      conversationId: input.conversationId,
      phase,
      brief,
      plan,
      assignments: [],
      events: [start, intake, planEvent],
    };
    await persist(repository, snapshot, input.privateSession, snapshot.events);
    useOrchestrationStore.getState().setCurrent(snapshot);
    useOrchestrationStore.getState().setPreparing(null);
    return plan.requiresConfirmation ? "confirmation" : "ready";
  } finally {
    const preparing = useOrchestrationStore.getState().preparing;
    if (preparing?.conversationId === input.conversationId) {
      useOrchestrationStore.getState().setPreparing(null);
    }
  }
}

export async function submitClarifications(
  answers: Readonly<Record<string, string>>,
  runtime: EvirRuntime,
  privateSession: boolean,
  planner?: PlanGeneratorPort,
): Promise<PreparationResult> {
  const current = useOrchestrationStore.getState().current;
  if (!current || current.phase !== "clarification") return "not-applicable";
  let brief = answerClarifications(current.brief, answers);
  const workspace = runtime.getWorkspaceRoot?.() ?? null;
  if (workspace) {
    brief = {
      ...brief,
      unknowns: brief.unknowns.map((unknown) =>
        unknown.impact === "permission" && !unknown.answer
          ? { ...unknown, answer: workspace }
          : unknown,
      ),
    };
  }
  const answered = createRunEvent(
    "clarification.answered",
    current.runId,
    current.conversationId,
    "Clarification answers recorded",
  );
  const unresolved = blockingUnknowns(brief);
  const repository = new OrchestrationRepository(runtime.structuredStorage!);
  if (unresolved.length > 0) {
    if (brief.clarificationRound >= 2) {
      const blocked = createRunEvent(
        "run.paused",
        current.runId,
        current.conversationId,
        "Task blocked after two clarification rounds",
        { data: { reason: "clarification-exhausted" } },
      );
      const next: OrchestrationSnapshot = {
        ...current,
        phase: "blocked",
        brief,
        events: [...current.events, answered, blocked],
      };
      await persist(repository, next, privateSession, [answered, blocked]);
      useOrchestrationStore.getState().setCurrent(next);
      return "blocked";
    }
    const requested = createRunEvent(
      "clarification.requested",
      current.runId,
      current.conversationId,
      "Further clarification required",
    );
    const next = { ...current, brief, events: [...current.events, answered, requested] };
    await persist(repository, next, privateSession, [answered, requested]);
    useOrchestrationStore.getState().setCurrent(next);
    return "clarification";
  }
  const plan = await buildValidatedPlan(brief, workspace, runtime, planner);
  const created = createRunEvent(
    "plan.created",
    current.runId,
    current.conversationId,
    "Execution plan created",
  );
  const next: OrchestrationSnapshot = {
    ...current,
    phase: plan.requiresConfirmation ? "confirmation" : "execution",
    brief,
    plan,
    events: [...current.events, answered, created],
  };
  await persist(repository, next, privateSession, [answered, created]);
  useOrchestrationStore.getState().setCurrent(next);
  return plan.requiresConfirmation ? "confirmation" : "ready";
}

export async function approveCurrentPlan(
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<boolean> {
  const current = useOrchestrationStore.getState().current;
  if (!current?.plan || current.phase !== "confirmation") return false;
  const plan = confirmPlan(current.plan);
  const event = createRunEvent(
    "plan.confirmed",
    current.runId,
    current.conversationId,
    "Plan confirmed",
  );
  const next = {
    ...current,
    phase: "execution" as const,
    plan,
    events: [...current.events, event],
  };
  if (!privateSession) {
    const repository = new OrchestrationRepository(runtime.structuredStorage!);
    await repository.persistPlanWithEvents(plan, [event]);
  }
  useOrchestrationStore.getState().setCurrent(next);
  return true;
}

export async function reviseCurrentPlan(
  nodeId: string,
  objective: string,
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<boolean> {
  const current = useOrchestrationStore.getState().current;
  if (!current?.plan || !["confirmation", "paused"].includes(current.phase) || !objective.trim())
    return false;
  const plan: PlanGraph = {
    ...current.plan,
    revision: current.plan.revision + 1,
    nodes: current.plan.nodes.map((node) =>
      node.id === nodeId && node.status !== "running"
        ? { ...node, objective: objective.trim() }
        : node,
    ),
    updatedAt: Date.now(),
  };
  assertPlan(plan, runtime, current.brief.goalKind !== "answer");
  const revision = validatePlanRevision(current.plan, plan);
  if (!revision.valid) throw new Error(`Invalid plan revision: ${revision.errors.join(", ")}`);
  const event = createRunEvent(
    "plan.revised",
    current.runId,
    current.conversationId,
    "Plan revised",
  );
  const next = { ...current, plan, events: [...current.events, event] };
  if (!privateSession) {
    const repository = new OrchestrationRepository(runtime.structuredStorage!);
    await repository.persistPlanWithEvents(plan, [event]);
  }
  useOrchestrationStore.getState().setCurrent(next);
  return true;
}

export async function markExecutionStarted(
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<void> {
  const current = useOrchestrationStore.getState().current;
  if (!current?.plan) return;
  const plan = { ...current.plan, status: "running" as const, updatedAt: Date.now() };
  const next = { ...current, phase: "execution" as const, plan };
  if (!privateSession)
    await new OrchestrationRepository(runtime.structuredStorage!).persistPlan(plan);
  useOrchestrationStore.getState().setCurrent(next);
}

export async function markExecutionFinished(
  runtime: EvirRuntime,
  privateSession: boolean,
  outcome: "completed" | "partial" | "failed" | "cancelled",
): Promise<void> {
  const current = useOrchestrationStore.getState().current;
  if (!current?.plan) return;
  const type =
    outcome === "completed"
      ? "run.completed"
      : outcome === "partial"
        ? "run.partial"
        : outcome === "failed"
          ? "run.failed"
          : "run.cancelled";
  const plan = {
    ...current.plan,
    status: outcome,
    nodes: current.plan.nodes.map((node) =>
      node.status === "completed"
        ? node
        : {
            ...node,
            status:
              outcome === "completed"
                ? ("completed" as const)
                : outcome === "cancelled"
                  ? ("cancelled" as const)
                  : ("failed" as const),
          },
    ),
    updatedAt: Date.now(),
  };
  const event = createRunEvent(type, current.runId, current.conversationId, `Run ${outcome}`);
  const next = { ...current, phase: "finished" as const, plan, events: [...current.events, event] };
  if (!privateSession) {
    const repository = new OrchestrationRepository(runtime.structuredStorage!);
    await repository.persistPlanWithEvents(plan, [event]);
  }
  useOrchestrationStore.getState().setCurrent(next);
}

export async function cancelCurrentRun(
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<void> {
  const runId = useOrchestrationStore.getState().current?.runId;
  const schedulerCancelled = runId ? cancelOrchestration(runId) : false;
  try {
    if (runId && !privateSession && runtime.structuredStorage) {
      const storage = runtime.structuredStorage;
      const pending = await storage.query<{
        id: string;
        runId: string;
        status: string;
        updatedAt: number;
      }>("approvals", { runId, status: "pending" });
      if (pending.length > 0) {
        const now = Date.now();
        await storage.apply(
          pending.map((approval) => ({
            type: "write" as const,
            entity: "approvals" as const,
            id: approval.id,
            data: { ...approval, status: "cancelled", updatedAt: now },
          })),
        );
      }
    }
  } finally {
    if (!runId || !schedulerCancelled) {
      await markExecutionFinished(runtime, privateSession, "cancelled");
    }
  }
}

export function pauseCurrentRun(): boolean {
  const runId = useOrchestrationStore.getState().current?.runId;
  return runId ? pauseOrchestration(runId) : false;
}

export async function resumeCurrentRun(
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<boolean> {
  const current = useOrchestrationStore.getState().current;
  if (!current?.plan || current.phase !== "paused") return false;
  const event = createRunEvent(
    "run.resumed",
    current.runId,
    current.conversationId,
    "Run resumed at a safe node boundary",
  );
  const plan: PlanGraph = { ...current.plan, status: "ready", updatedAt: Date.now() };
  if (!privateSession) {
    const repository = new OrchestrationRepository(runtime.structuredStorage!);
    await repository.persistPlanWithEvents(plan, [event]);
  }
  useOrchestrationStore.getState().setCurrent({
    ...current,
    phase: "execution",
    plan,
    events: [...current.events, event],
  });
  return true;
}

/**
 * 失败/取消后的重试：保留已完成节点，把其余节点按依赖重置为 ready/pending，
 * 计划回到 ready 并继续执行。高风险节点仍会逐次触发审批。
 */
export async function retryCurrentRun(
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<boolean> {
  const current = useOrchestrationStore.getState().current;
  if (!current?.plan || current.phase !== "finished") return false;
  if (current.plan.status === "completed") return false;
  const completedIds = new Set(
    current.plan.nodes.filter(({ status }) => status === "completed").map(({ id }) => id),
  );
  const nodes = current.plan.nodes.map((node) =>
    completedIds.has(node.id)
      ? node
      : {
          ...node,
          status: node.dependencies.every((dependency) => completedIds.has(dependency))
            ? ("ready" as const)
            : ("pending" as const),
        },
  );
  const event = createRunEvent(
    "node.ready",
    current.runId,
    current.conversationId,
    "Run retried from unfinished nodes",
  );
  const plan: PlanGraph = {
    ...current.plan,
    nodes,
    status: "ready",
    updatedAt: Date.now(),
  };
  if (!privateSession) {
    const repository = new OrchestrationRepository(runtime.structuredStorage!);
    await repository.persistPlanWithEvents(plan, [event]);
  }
  useOrchestrationStore.getState().setCurrent({
    ...current,
    phase: "execution",
    plan,
    events: [...current.events, event],
  });
  return true;
}

export async function resolveCurrentApprovalNode(
  runtime: EvirRuntime,
  privateSession: boolean,
  nodeId: string,
  outcome: "completed" | "failed",
  summary: string,
): Promise<boolean> {
  const current = useOrchestrationStore.getState().current;
  const blocked = current?.plan?.nodes.find(
    ({ id, status }) => id === nodeId && status === "blocked",
  );
  if (!current?.plan || !blocked) return false;
  const event = createRunEvent(
    outcome === "completed" ? "tool.completed" : "node.failed",
    current.runId,
    current.conversationId,
    summary,
    { nodeId: blocked.id },
  );
  const plan: PlanGraph = {
    ...current.plan,
    status: "ready",
    nodes: current.plan.nodes.map((node) =>
      node.id === blocked.id ? { ...node, status: outcome } : node,
    ),
    updatedAt: Date.now(),
  };
  const assignments = current.assignments.map((assignment) =>
    assignment.nodeId === blocked.id && assignment.status === "blocked"
      ? { ...assignment, status: outcome, updatedAt: Date.now() }
      : assignment,
  );
  if (!privateSession) {
    const repository = new OrchestrationRepository(runtime.structuredStorage!);
    await repository.persistSnapshot({ ...current, plan, assignments }, [event]);
  }
  useOrchestrationStore.getState().setCurrent({
    ...current,
    plan,
    assignments,
    phase: "execution",
    events: [...current.events, event],
  });
  return true;
}
