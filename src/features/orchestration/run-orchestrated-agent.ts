import { createRunEvent, OrchestrationRepository } from "../../core/orchestration/repository";
import { GraphScheduler } from "../../core/orchestration/scheduler";
import type { NodeExecutionResult } from "../../core/orchestration/scheduler";
import type { DoneWhenResult, PlanGraph, PlanNode } from "../../core/orchestration/types";
import {
  MAX_AUTO_CONTINUATIONS,
  decideContinuation,
  doneWhenSignature,
  planProgressSignature,
  repairNodeForUnmetDoneWhen,
} from "./continuation-policy";
import { getActiveWorkspaceRoot, popRunRoot, pushRunRoot } from "../../core/workspace/active-root";
import { permissionContextForRunWithGrants } from "../projects/run-permission";
import { logRunContext, runBindingForConversation } from "../chat/run-context";
import { doneWhenSatisfied, evaluateDoneWhen } from "../../core/orchestration/done-when";
import { runAgentLoop, type AgentLoopResult } from "../chat/agent-loop";
import { useOrchestrationStore } from "./orchestration-store";
import {
  createRunIo,
  type OrchestratedRunInput,
  type OrchestratedRunState,
} from "./orchestrated-run-state";
import { eventForResult, executeNode } from "./orchestrated-node-execution";

export type { OrchestratedRunInput };

const activeSchedulers = new Map<string, GraphScheduler>();

export function pauseOrchestration(runId: string): boolean {
  const scheduler = activeSchedulers.get(runId);
  scheduler?.pause();
  return Boolean(scheduler);
}

export function cancelOrchestration(runId: string): boolean {
  const scheduler = activeSchedulers.get(runId);
  scheduler?.cancel();
  return Boolean(scheduler);
}

function collapseIntermediateTurns(turns: AgentLoopResult["turns"]): AgentLoopResult["turns"] {
  let finalTextIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.stream.content.trim()) {
      finalTextIndex = index;
      break;
    }
  }
  if (finalTextIndex < 0) return turns;
  return turns.flatMap((turn, index) => {
    if (index === finalTextIndex || turn.stream.status !== "complete" || turn.pendingApproval) {
      return [turn];
    }
    if ((turn.toolCalls?.length ?? 0) > 0 || (turn.toolResults?.length ?? 0) > 0) {
      return [{ ...turn, stream: { ...turn.stream, content: "" } }];
    }
    return [];
  });
}

export async function runOrchestratedAgent(input: OrchestratedRunInput): Promise<AgentLoopResult> {
  // Bind the workspace root for the whole orchestrated run so node loops all
  // execute in the originating project even if the user switches projects
  // mid-run in the sidebar. §17/§18: the binding comes from the
  // conversation's persisted projectId (with scoped grants, §37b) — a
  // Goal/Plan continuation must not lose the original permission context.
  const binding = await runBindingForConversation(input.conversationId);
  const runRoot = binding.root ?? getActiveWorkspaceRoot();
  const permissionContext =
    binding.permissionContext ?? (await permissionContextForRunWithGrants(runRoot));
  pushRunRoot(runRoot, permissionContext);
  try {
    await logRunContext({
      conversationId: input.conversationId,
      runId: input.runtime.agentRun?.id ?? "pending",
      binding,
      source: binding.permissionContext ? "conversation-project" : "legacy-fallback",
    });
    return await runOrchestratedAgentBound(input);
  } finally {
    popRunRoot();
  }
}

async function runOrchestratedAgentBound(input: OrchestratedRunInput): Promise<AgentLoopResult> {
  const { conversationId } = input;
  const initial = useOrchestrationStore.getState().snapshotFor(conversationId);
  if (!initial?.plan || initial.conversationId !== input.conversationId) {
    return runAgentLoop({ ...input, mode: "agent" });
  }
  const initialPlan: PlanGraph = initial.plan;
  const state: OrchestratedRunState = {
    input,
    initial,
    repository: new OrchestrationRepository(input.runtime.structuredStorage!),
    conversationId,
    turns: [],
    approvalContexts: [],
    completedSummaries: new Map(
      initial.events.flatMap(({ type, nodeId, summary }) =>
        type === "node.completed" && nodeId ? [[nodeId, summary] as const] : [],
      ),
    ),
    verificationEvidence: new Set(
      initial.events.flatMap(({ type, nodeId }) =>
        type === "verification.completed" && nodeId ? [nodeId] : [],
      ),
    ),
    pendingPlanEvents: [],
    managerRun: {
      id: initial.runId,
      snapshots: [],
      fileReferences: [],
    },
    nodeExecutions: 0,
    runStartedAt: Date.now(),
  };
  const io = createRunIo(state);
  const executor = (node: PlanNode, signal: AbortSignal): Promise<NodeExecutionResult> =>
    executeNode(state, io, node, signal, executor);

  const scheduler = createScheduler(state, io, executor);
  activeSchedulers.set(initial.runId, scheduler);
  const abortScheduler = () => scheduler.cancel();
  if (input.signal?.aborted) scheduler.cancel();
  else input.signal?.addEventListener("abort", abortScheduler, { once: true });
  let plan: PlanGraph;
  try {
    plan = await runWithAutoReplan(state, io, scheduler, initialPlan);
  } finally {
    input.signal?.removeEventListener("abort", abortScheduler);
    activeSchedulers.delete(initial.runId);
  }
  plan = await continueUnfinishedWork(state, io, scheduler, plan);
  plan = await enforceGoalEvidence(state, io, plan);
  return finalizeRun(state, plan);
}

function createScheduler(
  state: OrchestratedRunState,
  io: ReturnType<typeof createRunIo>,
  executor: (node: PlanNode, signal: AbortSignal) => Promise<NodeExecutionResult>,
): GraphScheduler {
  const { input, initial, conversationId, verificationEvidence } = state;
  const { queuePlanEvent } = io;
  return new GraphScheduler(executor, 2, {
    onNodeReady: (node) => {
      queuePlanEvent(
        createRunEvent("node.ready", initial.runId, input.conversationId, node.title, {
          nodeId: node.id,
        }),
      );
    },
    onNodeStarted: (node) => {
      queuePlanEvent(
        createRunEvent("node.started", initial.runId, input.conversationId, node.title, {
          nodeId: node.id,
        }),
      );
    },
    onNodeFinished: (node, result) => {
      queuePlanEvent(
        createRunEvent(
          eventForResult(result),
          initial.runId,
          input.conversationId,
          result.summary,
          {
            nodeId: node.id,
          },
        ),
      );
      if (node.kind === "verification" && result.status === "completed") {
        verificationEvidence.add(node.id);
        queuePlanEvent(
          createRunEvent(
            "verification.completed",
            initial.runId,
            input.conversationId,
            result.summary,
            { nodeId: node.id },
          ),
        );
      }
    },
    onNodeSkipped: (node) => {
      queuePlanEvent(
        createRunEvent("node.skipped", initial.runId, input.conversationId, node.title, {
          nodeId: node.id,
        }),
      );
    },
    onPlanChanged: async (plan) => {
      const events = state.pendingPlanEvents.splice(0);
      if (!input.privateSession) await state.repository.persistPlanWithEvents(plan, events);
      const current = useOrchestrationStore.getState().snapshotFor(conversationId);
      if (current?.runId === initial.runId)
        useOrchestrationStore.getState().setCurrent({
          ...current,
          plan,
          phase: plan.status === "paused" ? "paused" : "execution",
        });
    },
  });
}

/**
 * Dynamic re-plan: a failed step gets one automatic retry revision so the
 * supervisor can recover without losing completed work. The revision is
 * persisted and visible in the execution trace; the goal never changes.
 */
async function runWithAutoReplan(
  state: OrchestratedRunState,
  io: ReturnType<typeof createRunIo>,
  scheduler: GraphScheduler,
  initialPlan: PlanGraph,
): Promise<PlanGraph> {
  const MAX_REPLAN_NODE_EXECUTIONS = 18;
  const { input, initial, conversationId } = state;
  const { appendEvent } = io;
  let plan = await scheduler.run(initialPlan);
  const failedNodes = plan.nodes.filter(({ status }) => status === "failed");
  if (
    plan.status === "failed" &&
    failedNodes.length > 0 &&
    state.nodeExecutions <= MAX_REPLAN_NODE_EXECUTIONS &&
    !input.signal?.aborted
  ) {
    const revised: PlanGraph = {
      ...plan,
      revision: plan.revision + 1,
      status: "ready",
      updatedAt: Date.now(),
      nodes: plan.nodes.map((node) =>
        node.status === "failed" ? { ...node, status: "ready" as const } : node,
      ),
    };
    await appendEvent(
      createRunEvent(
        "plan.revised",
        initial.runId,
        input.conversationId,
        `Auto re-plan: retrying ${failedNodes.length} failed step(s)`,
        { data: { revision: revised.revision, retriedNodes: failedNodes.map(({ id }) => id) } },
      ),
    );
    const currentSnapshot = useOrchestrationStore.getState().snapshotFor(conversationId);
    if (currentSnapshot?.runId === initial.runId) {
      useOrchestrationStore
        .getState()
        .setCurrent({ ...currentSnapshot, plan: revised, phase: "execution" });
    }
    if (!input.privateSession) await state.repository.persistPlanWithEvents(revised, []);
    plan = await scheduler.run(revised);
  }
  return plan;
}

/**
 * §H2 continuation: a natural model finish is not task completion while the
 * plan explicitly has unfinished work. Bounded loop — MAX_AUTO_CONTINUATIONS,
 * a progress signature that must change between attempts, the abort signal
 * respected at every step, and every decision traced as a run event.
 */
async function continueUnfinishedWork(
  state: OrchestratedRunState,
  io: ReturnType<typeof createRunIo>,
  scheduler: GraphScheduler,
  plan: PlanGraph,
): Promise<PlanGraph> {
  const { input, initial, conversationId } = state;
  const { appendEvent } = io;
  let current = plan;
  let previousSignature: string | null = null;
  for (let attempt = 1; attempt <= MAX_AUTO_CONTINUATIONS; attempt += 1) {
    if (input.signal?.aborted) {
      await appendEvent(
        createRunEvent("continuation.stopped", initial.runId, conversationId, "Aborted by user", {
          data: { attempt, outcome: "aborted" },
        }),
      );
      break;
    }
    const doneWhen = initial.brief.doneWhen ?? [];
    let evaluated: readonly DoneWhenResult[] | null = null;
    if (current.status === "completed" && doneWhen.length > 0) {
      evaluated = await evaluateDoneWhen(
        doneWhen,
        input.runtime,
        input.runtime.getWorkspaceRoot?.() ?? null,
      );
    }
    const decision = decideContinuation(current, evaluated);
    if (!decision.continue || !decision.reason) break;
    if (decision.reason === "unmet-done-when" && evaluated) {
      const signature = doneWhenSignature(evaluated);
      if (signature === previousSignature) {
        await appendEvent(
          createRunEvent(
            "continuation.stopped",
            initial.runId,
            conversationId,
            "No progress since the previous continuation — stopping",
            { data: { attempt, outcome: "no-progress" } },
          ),
        );
        break;
      }
      previousSignature = signature;
    }
    await appendEvent(
      createRunEvent(
        "continuation.requested",
        initial.runId,
        conversationId,
        `Auto continuation ${attempt}: ${decision.reason === "unfinished-nodes" ? "plan has unexecuted steps" : "done-when conditions unmet"}`,
        { data: { attempt, reason: decision.reason, detail: decision.detail } },
      ),
    );
    let next: PlanGraph;
    if (decision.reason === "unfinished-nodes") {
      next = await scheduler.run(current);
      const signature = planProgressSignature(next);
      if (signature === previousSignature) {
        await appendEvent(
          createRunEvent(
            "continuation.stopped",
            initial.runId,
            conversationId,
            "No progress since the previous continuation — stopping",
            { data: { attempt, outcome: "no-progress" } },
          ),
        );
        return next;
      }
      previousSignature = signature;
    } else {
      const repair = repairNodeForUnmetDoneWhen(decision.detail, attempt, current);
      next = {
        ...current,
        revision: current.revision + 1,
        status: "ready",
        updatedAt: Date.now(),
        nodes: [...current.nodes, repair],
        edges: [...current.edges],
      };
      const snapshot = useOrchestrationStore.getState().snapshotFor(conversationId);
      if (snapshot?.runId === initial.runId) {
        useOrchestrationStore
          .getState()
          .setCurrent({ ...snapshot, plan: next, phase: "execution" });
      }
      if (!input.privateSession) await state.repository.persistPlanWithEvents(next, []);
      next = await scheduler.run(next);
    }
    current = next;
  }
  return current;
}

/**
 * Goal-evidence gates: a "completed" run without goalKind=answer must have
 * verification evidence, and Done-when criteria are re-executed against the
 * workspace — model text alone never completes a goal.
 */
async function enforceGoalEvidence(
  state: OrchestratedRunState,
  io: ReturnType<typeof createRunIo>,
  plan: PlanGraph,
): Promise<PlanGraph> {
  const { input, initial, conversationId, verificationEvidence } = state;
  const { appendEvent } = io;
  if (
    plan.status === "completed" &&
    initial.brief.goalKind !== "answer" &&
    verificationEvidence.size === 0
  ) {
    plan = { ...plan, status: "failed", updatedAt: Date.now() };
  }
  if (plan.status === "completed" && (initial.brief.doneWhen?.length ?? 0) > 0) {
    const doneWhenResults = await evaluateDoneWhen(
      initial.brief.doneWhen ?? [],
      input.runtime,
      input.runtime.getWorkspaceRoot?.() ?? null,
    );
    const satisfied = doneWhenSatisfied(doneWhenResults);
    if (!input.privateSession) {
      await state.repository.persistBrief({
        ...initial.brief,
        doneWhenResults,
        updatedAt: Date.now(),
      });
    }
    const current = useOrchestrationStore.getState().snapshotFor(conversationId);
    if (current?.runId === initial.runId) {
      useOrchestrationStore.getState().setCurrent({
        ...current,
        brief: { ...current.brief, doneWhenResults },
      });
    }
    await appendEvent(
      createRunEvent(
        satisfied ? "goal.verification.passed" : "goal.verification.failed",
        initial.runId,
        input.conversationId,
        satisfied ? "All executable Done-when criteria verified" : "Done-when verification failed",
        {
          data: {
            doneWhen: doneWhenResults.map(({ label, status }) => ({ label, status })),
          },
        },
      ),
    );
    if (!satisfied) {
      plan = { ...plan, status: "failed", updatedAt: Date.now() };
    }
  }
  return plan;
}

async function finalizeRun(state: OrchestratedRunState, plan: PlanGraph): Promise<AgentLoopResult> {
  const { input, initial, conversationId, turns, approvalContexts, managerRun } = state;
  const terminalType =
    plan.status === "completed"
      ? "run.completed"
      : plan.status === "partial"
        ? "run.partial"
        : plan.status === "cancelled"
          ? "run.cancelled"
          : plan.status === "paused"
            ? "run.paused"
            : "run.failed";
  const terminalEvent = createRunEvent(
    terminalType,
    initial.runId,
    input.conversationId,
    `Run ${plan.status}`,
  );
  if (!input.privateSession) await state.repository.persistPlanWithEvents(plan, [terminalEvent]);
  const current = useOrchestrationStore.getState().snapshotFor(conversationId);
  if (current?.runId === initial.runId) {
    useOrchestrationStore.getState().setCurrent({
      ...current,
      plan,
      phase: plan.status === "paused" ? "paused" : "finished",
      events: [...current.events, terminalEvent],
    });
  }
  return {
    turns: approvalContexts.length > 0 ? turns : collapseIntermediateTurns(turns),
    maxIterationsReached: turns.some(({ stream }) => stream.errorMessage === "tools.maxIterations"),
    messages: input.messages,
    agentRun: managerRun,
    ...(approvalContexts.length > 0 ? { approvalContexts } : {}),
  };
}
