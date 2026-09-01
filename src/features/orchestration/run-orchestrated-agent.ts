import { AgentDispatcher, restrictTools } from "../../core/orchestration/agent-dispatcher";
import { createRunEvent, OrchestrationRepository } from "../../core/orchestration/repository";
import { GraphScheduler, type NodeExecutionResult } from "../../core/orchestration/scheduler";
import { logger } from "../../core/logging/logger";
import { getActiveWorkspaceRoot, popRunRoot, pushRunRoot } from "../../core/workspace/active-root";
import { permissionContextForRoot } from "../projects/run-permission";
import { doneWhenSatisfied, evaluateDoneWhen } from "../../core/orchestration/done-when";
import { goalBudgetExceeded, tokensSpentSince } from "../../core/orchestration/goal-budget";
import type {
  AgentAssignment,
  PlanGraph,
  PlanNode,
  RunEventV1,
  WorkerReport,
} from "../../core/orchestration/types";
import { ToolRegistryImpl } from "../../core/tools/tool-registry-impl";
import { applyVerificationVerdict } from "./verification-verdict";
import { ToolExecutor } from "../../core/tools/tool-executor";
import type { ProviderRecord } from "../../core/storage/db";
import type { EvirRuntime } from "../../runtime/types";
import {
  runAgentLoop,
  type AgentApprovalContext,
  type AgentLoopResult,
  type AgentMessage,
} from "../chat/agent-loop";
import { useOrchestrationStore } from "./orchestration-store";

interface OrchestratedRunInput {
  provider: ProviderRecord;
  conversationId: string;
  messages: AgentMessage[];
  runtime: EvirRuntime;
  privateSession: boolean;
  onDelta(content: string): void;
  signal?: AbortSignal;
}

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

function scopedRuntime(runtime: EvirRuntime, allowedToolIds: readonly string[]) {
  const registry = new ToolRegistryImpl();
  const allowed = new Set(allowedToolIds);
  for (const tool of runtime.toolRegistry?.list() ?? []) {
    if (allowed.has(tool.id)) registry.register(tool);
  }
  return {
    ...runtime,
    toolRegistry: registry,
    toolExecutor: new ToolExecutor(registry),
    agentRun: { id: crypto.randomUUID(), snapshots: [], fileReferences: [] },
  } satisfies EvirRuntime;
}

function toolsForNode(node: PlanNode, runtime: EvirRuntime): string[] {
  const writes = node.resourceScopes.some(({ access }) => access === "write");
  return (runtime.toolRegistry?.list() ?? [])
    .filter((tool) => {
      if (!tool.requiredCapability || node.requiredCapabilities.includes(tool.requiredCapability)) {
        return true;
      }
      // Read-only browsing (browser_open/snapshot/screenshot/…) is L1 — the
      // same tier as read_file — so any node may offer it without declaring a
      // browser capability. Mutating browser actions (L2+) still require the
      // node's explicit capability set.
      return tool.riskLevel === "L0" || tool.riskLevel === "L1";
    })
    .filter(
      (tool) =>
        writes ||
        tool.riskLevel === "L0" ||
        tool.riskLevel === "L1" ||
        // Verification nodes exist to run the acceptance commands the confirmed
        // plan promised; execution-time approval gating still applies.
        (node.kind === "verification" && tool.id === "run_command"),
    )
    .map(({ id }) => id);
}

function nodeMessages(
  messages: AgentMessage[],
  node: PlanNode,
  completedSummaries: ReadonlyMap<string, string>,
): AgentMessage[] {
  const protectedMessages = messages.filter(({ role }) => role === "system");
  const recentDialogue = messages
    .filter(
      ({ role, content }) =>
        (role === "user" || role === "assistant") &&
        typeof content === "string" &&
        content.trim().length > 0,
    )
    .slice(-8)
    .map((message) => ({
      ...message,
      content:
        typeof message.content === "string" ? message.content.slice(0, 4_000) : message.content,
    }));
  const dependencies = node.dependencies
    .map((id) => completedSummaries.get(id))
    .filter((value): value is string => Boolean(value));
  return [
    ...protectedMessages,
    ...recentDialogue,
    {
      role: "system",
      content: [
        `Execute only this plan node: ${node.title}.`,
        `Objective: ${node.objective}`,
        node.successCriteria.length ? `Success criteria: ${node.successCriteria.join("; ")}` : "",
        dependencies.length ? `Dependency results:\n${dependencies.join("\n")}` : "",
        "Do not create another agent. Return a concise result with observable evidence.",
        ...(node.kind === "verification"
          ? [
              // Structured verdict line: the scheduler consumes this machine-
              // readable status instead of parsing natural-language prose.
              "End your reply with exactly one final line:",
              "VERIFICATION_STATUS: PASSED | FAILED | PARTIAL",
              "FAILED means acceptance criteria are not met; PARTIAL means some are met with explicit gaps.",
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

function loopStatus(result: AgentLoopResult): NodeExecutionResult["status"] {
  const last = result.turns.at(-1);
  if (last?.pendingApproval) return "blocked";
  if (last?.stream.status === "stopped") return "cancelled";
  if (last?.stream.status === "error") return "failed";
  // An exhausted iteration budget is not by itself a failure: genuine stuck
  // loops surface as stream errors from the loop-detection middleware above.
  // Here the model kept making distinct tool calls until the cap — let the
  // node complete with whatever evidence it produced so downstream nodes
  // (and the user) can act on it instead of discarding the whole run.
  return "completed";
}

function loopSummary(result: AgentLoopResult): string {
  const text = result.turns.at(-1)?.stream.content.trim();
  if (text) return text;
  return result.maxIterationsReached
    ? "Iteration budget reached before a final summary (tool evidence preserved)"
    : "Node completed without a text summary";
}

function reportFromLoop(assignment: AgentAssignment, result: AgentLoopResult): WorkerReport {
  const nodeStatus = loopStatus(result);
  const evidence = result.turns.flatMap((turn) =>
    (turn.toolResults ?? [])
      .filter(({ success }) => success)
      .map(({ toolName, output }) => `${toolName}: ${output.slice(0, 500)}`),
  );
  const errors = result.turns.flatMap((turn) =>
    (turn.toolResults ?? [])
      .filter(({ success }) => !success)
      .map(({ toolName, error, output }) => `${toolName}: ${error ?? output}`),
  );
  return {
    assignmentId: assignment.id,
    status:
      nodeStatus === "completed"
        ? "completed"
        : nodeStatus === "cancelled"
          ? "cancelled"
          : evidence.length > 0
            ? "partial"
            : "failed",
    summary: loopSummary(result),
    artifacts: result.agentRun.fileReferences.map(({ path }) => path),
    verificationEvidence: evidence,
    unresolvedErrors: errors,
  };
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

function eventForResult(result: NodeExecutionResult): RunEventV1["type"] {
  if (result.status === "completed") return "node.completed";
  if (result.status === "blocked") return "node.blocked";
  return "node.failed";
}

export async function runOrchestratedAgent(input: OrchestratedRunInput): Promise<AgentLoopResult> {
  // Bind the workspace root for the whole orchestrated run so node loops all
  // execute in the originating project even if the user switches projects
  // mid-run in the sidebar.
  const runRoot = getActiveWorkspaceRoot();
  pushRunRoot(runRoot, permissionContextForRoot(runRoot));
  try {
    return await runOrchestratedAgentBound(input);
  } finally {
    popRunRoot();
  }
}

async function runOrchestratedAgentBound(input: OrchestratedRunInput): Promise<AgentLoopResult> {
  const initial = useOrchestrationStore.getState().current;
  if (!initial?.plan || initial.conversationId !== input.conversationId) {
    return runAgentLoop({ ...input, mode: "agent" });
  }
  const repository = new OrchestrationRepository(input.runtime.structuredStorage!);
  const turns: AgentLoopResult["turns"] = [];
  // Run-level guardrails (see goalBudgetExceeded): exceeding the node or
  // wall-clock budget pauses the run as blocked instead of silently continuing.
  const runStartedAt = Date.now();
  let nodeExecutions = 0;
  // Re-planning is capped well below the hard node budget.
  const MAX_REPLAN_NODE_EXECUTIONS = 18;
  const approvalContexts: AgentApprovalContext[] = [];
  const completedSummaries = new Map(
    initial.events.flatMap(({ type, nodeId, summary }) =>
      type === "node.completed" && nodeId ? [[nodeId, summary] as const] : [],
    ),
  );
  const verificationEvidence = new Set(
    initial.events.flatMap(({ type, nodeId }) =>
      type === "verification.completed" && nodeId ? [nodeId] : [],
    ),
  );
  const pendingPlanEvents: RunEventV1[] = [];
  const managerRun = {
    id: initial.runId,
    snapshots: [],
    fileReferences: [],
  } as AgentLoopResult["agentRun"];

  const appendEvent = async (event: RunEventV1): Promise<void> => {
    if (!input.privateSession) await repository.appendEvent(event);
    const current = useOrchestrationStore.getState().current;
    if (current?.runId === initial.runId) {
      useOrchestrationStore
        .getState()
        .setCurrent({ ...current, events: [...current.events, event] });
    }
  };

  const queuePlanEvent = (event: RunEventV1): void => {
    pendingPlanEvents.push(event);
    const current = useOrchestrationStore.getState().current;
    if (current?.runId === initial.runId) {
      useOrchestrationStore
        .getState()
        .setCurrent({ ...current, events: [...current.events, event] });
    }
  };

  const updateAssignment = async (assignment: AgentAssignment): Promise<void> => {
    if (!input.privateSession) await repository.persistAssignment(assignment);
    const current = useOrchestrationStore.getState().current;
    if (!current || current.runId !== initial.runId) return;
    const assignments = current.assignments.some(({ id }) => id === assignment.id)
      ? current.assignments.map((item) => (item.id === assignment.id ? assignment : item))
      : [...current.assignments, assignment];
    useOrchestrationStore.getState().setCurrent({ ...current, assignments });
  };

  const budgetBlocked = async (): Promise<string | null> => {
    let tokensSpent = 0;
    try {
      const usage = await input.runtime.structuredStorage?.query<Record<string, unknown>>(
        "usage_records",
        { conversationId: input.conversationId },
      );
      tokensSpent = tokensSpentSince(
        (usage ?? []) as unknown as Parameters<typeof tokensSpentSince>[0],
        input.conversationId,
        runStartedAt,
      );
    } catch {
      // Budget checks never break execution when usage is unreadable.
    }
    const reason = goalBudgetExceeded(nodeExecutions, Date.now() - runStartedAt, tokensSpent);
    if (reason) {
      await appendEvent(createRunEvent("run.blocked", initial.runId, input.conversationId, reason));
      return reason;
    }
    return null;
  };

  const executeLoop = async (node: PlanNode, signal: AbortSignal, worker: boolean) => {
    nodeExecutions += 1;
    const allowedTools = toolsForNode(node, input.runtime);
    const runtime = scopedRuntime(input.runtime, allowedTools);
    // Verification nodes run acceptance commands, so they need the agent tool
    // profile; the node-level boundary is toolsForNode's allowlist above.
    const mode =
      node.resourceScopes.some(({ access }) => access === "write") || node.kind === "verification"
        ? "agent"
        : "plan";
    const result = await runAgentLoop({
      provider: input.provider,
      conversationId: input.conversationId,
      messages: nodeMessages(input.messages, node, completedSummaries),
      runtime,
      onDelta: worker ? () => undefined : (content) => input.onDelta(content),
      maxIterations: 12,
      mode,
      signal,
    });
    const pendingTurn = result.turns.find(({ pendingApproval }) => pendingApproval);
    if (pendingTurn) {
      approvalContexts.push({
        runId: initial.runId,
        nodeId: node.id,
        mode,
        allowedToolIds: allowedTools,
        messages: result.messages,
        turn: pendingTurn,
        agentRun: result.agentRun,
      });
    }
    managerRun.snapshots.push(...result.agentRun.snapshots);
    managerRun.fileReferences.push(...result.agentRun.fileReferences);
    return result;
  };

  const executeNodeInner = async (
    node: PlanNode,
    signal: AbortSignal,
  ): Promise<NodeExecutionResult> => {
    if (signal.aborted) return { status: "cancelled", summary: "Cancelled before execution" };
    if (node.kind === "approval") {
      const confirmed = useOrchestrationStore
        .getState()
        .current?.events.some(({ type }) => type === "plan.confirmed");
      return confirmed
        ? { status: "completed", summary: "Plan-level approval confirmed by the user" }
        : { status: "blocked", summary: "Plan-level approval is awaiting user confirmation" };
    }
    if (node.kind === "join" && node.requiredCapabilities.length === 0) {
      const summary = node.dependencies
        .map((id) => completedSummaries.get(id))
        .filter(Boolean)
        .join("\n");
      completedSummaries.set(node.id, summary);
      return { status: "completed", summary: summary || "Dependencies joined" };
    }
    if (node.kind === "subgraph") {
      const workflow = node.subgraphId
        ? input.runtime.workflowRegistry?.get(node.subgraphId)
        : undefined;
      if (!workflow) return { status: "failed", summary: "Built-in workflow is unavailable" };
      const childNodes = workflow.nodes.map((item, index) => {
        const id = `${node.id}/${index + 1}`;
        const dependencies = workflow.edges
          .filter(({ toIndex }) => toIndex === index)
          .map(({ fromIndex }) => `${node.id}/${fromIndex + 1}`);
        return {
          ...item,
          id,
          dependencies,
          requiredCapabilities: item.requiredCapabilities.length
            ? item.requiredCapabilities
            : node.requiredCapabilities,
          resourceScopes: item.resourceScopes.length ? item.resourceScopes : node.resourceScopes,
          status: dependencies.length === 0 ? ("ready" as const) : ("pending" as const),
        };
      });
      const childPlan: PlanGraph = {
        ...initial.plan!,
        id: `${initial.plan!.id}:${node.id}`,
        nodes: childNodes,
        edges: workflow.edges.map(({ fromIndex, toIndex, when }) => ({
          from: `${node.id}/${fromIndex + 1}`,
          to: `${node.id}/${toIndex + 1}`,
          when,
        })),
        status: "ready",
        requiresConfirmation: false,
      };
      const nested = await new GraphScheduler(executor, 2, {
        onNodeReady: async (child) => {
          await appendEvent(
            createRunEvent("node.ready", initial.runId, input.conversationId, child.title, {
              nodeId: child.id,
            }),
          );
        },
        onNodeStarted: async (child) => {
          await appendEvent(
            createRunEvent("node.started", initial.runId, input.conversationId, child.title, {
              nodeId: child.id,
            }),
          );
        },
        onNodeFinished: async (child, result) => {
          await appendEvent(
            createRunEvent(
              eventForResult(result),
              initial.runId,
              input.conversationId,
              result.summary,
              { nodeId: child.id },
            ),
          );
        },
      }).run(childPlan);
      const summary = `Built-in workflow ${workflow.id}@${workflow.version} finished with ${nested.status}`;
      completedSummaries.set(node.id, summary);
      return {
        status:
          nested.status === "completed"
            ? "completed"
            : nested.status === "cancelled"
              ? "cancelled"
              : nested.status === "paused"
                ? "blocked"
                : "failed",
        summary,
      };
    }
    if (node.kind !== "subagent") {
      const budgetReason = await budgetBlocked();
      if (budgetReason) return { status: "blocked", summary: budgetReason };
      const result = await executeLoop(node, signal, false);
      turns.push(...result.turns);
      const summary = loopSummary(result);
      completedSummaries.set(node.id, summary);
      if (
        node.kind === "verification" &&
        !result.turns.some((turn) => turn.toolResults?.some(({ success }) => success))
      ) {
        return {
          status: "failed",
          summary: "Verification produced no successful tool evidence",
        };
      }
      // Structured verdict first (VERIFICATION_STATUS marker), natural-
      // language regex only as legacy fallback. A verification that ran but
      // did not pass must not sail through as a completed run.
      const judged = applyVerificationVerdict(node, {
        status: loopStatus(result),
        summary,
      });
      if (node.kind === "verification" && judged.status === "completed")
        verificationEvidence.add(node.id);
      return judged;
    }

    const parentTools = input.runtime.toolRegistry?.list().map(({ id }) => id) ?? [];
    const subagentBudgetReason = await budgetBlocked();
    if (subagentBudgetReason) {
      return { status: "blocked", summary: subagentBudgetReason };
    }
    const rootForWorktree = input.runtime.getWorkspaceRoot?.() ?? null;
    const isolated =
      node.isolation === "worktree" &&
      Boolean(rootForWorktree) &&
      typeof input.runtime.storage?.gitWorktreeCreate === "function";
    let worktreePath: string | null = null;
    if (isolated && rootForWorktree && input.runtime.storage?.gitWorktreeCreate) {
      try {
        worktreePath = await input.runtime.storage.gitWorktreeCreate(
          rootForWorktree,
          node.id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24),
        );
        await appendEvent(
          createRunEvent("node.started", initial.runId, input.conversationId, node.title, {
            nodeId: node.id,
            data: { isolatedWorktree: worktreePath },
          }),
        );
      } catch (error) {
        return {
          status: "failed",
          summary: `Worktree isolation unavailable: ${error instanceof Error ? error.message : "git worktree failed"}`,
        };
      }
    }
    const dispatcher = new AgentDispatcher({
      execute: async (assignment, workerSignal) => {
        if (worktreePath) pushRunRoot(worktreePath, permissionContextForRoot(worktreePath));
        let result;
        try {
          result = await executeLoop(node, workerSignal, true);
        } finally {
          if (worktreePath) popRunRoot();
        }
        turns.push(...result.turns);
        return reportFromLoop(assignment, result);
      },
    });
    const assignment = dispatcher.createAssignment({
      parentRunId: initial.runId,
      nodeId: node.id,
      objective: node.objective,
      allowedTools: restrictTools(parentTools, toolsForNode(node, input.runtime)),
      resourceScopes: node.resourceScopes,
      contextReferences: node.dependencies,
      expectedOutputSchema: { type: "object", required: ["summary", "verificationEvidence"] },
      budget: { maxTurns: 12 },
    });
    await appendEvent(
      createRunEvent("agent.spawned", initial.runId, input.conversationId, node.title, {
        nodeId: node.id,
        assignmentId: assignment.id,
      }),
    );
    await updateAssignment({ ...assignment, status: "running", updatedAt: Date.now() });
    const report = await dispatcher.dispatch(assignment, signal);
    if (worktreePath && rootForWorktree && input.runtime.storage) {
      const worktreeId = node.id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24);
      try {
        if (report.status !== "cancelled") {
          await input.runtime.storage.gitWorktreeMerge(rootForWorktree, worktreeId);
        }
      } catch (error) {
        await appendEvent(
          createRunEvent("node.failed", initial.runId, input.conversationId, node.title, {
            nodeId: node.id,
            data: { mergeConflict: true },
          }),
        );
        return {
          status: "failed",
          summary: `Worktree merge conflict: ${error instanceof Error ? error.message : "apply failed"}`,
        };
      } finally {
        await input.runtime.storage
          .gitWorktreeRemove(rootForWorktree, worktreeId)
          .catch(() => undefined);
      }
    }
    if (approvalContexts.some(({ nodeId }) => nodeId === node.id)) {
      await updateAssignment({ ...assignment, status: "blocked", updatedAt: Date.now() });
      return { status: "blocked", summary: "Worker is waiting for tool approval" };
    }
    const finalAssignment = { ...assignment, status: report.status, updatedAt: Date.now() };
    await appendEvent(
      createRunEvent(
        report.status === "completed" ? "agent.completed" : "agent.failed",
        initial.runId,
        input.conversationId,
        report.summary,
        {
          nodeId: node.id,
          assignmentId: assignment.id,
          data: {
            artifacts: report.artifacts,
            verificationEvidence: report.verificationEvidence,
            unresolvedErrors: report.unresolvedErrors,
          },
        },
      ),
    );
    await updateAssignment(finalAssignment);
    completedSummaries.set(node.id, report.summary);
    return {
      status: report.status === "partial" ? "failed" : report.status,
      summary: report.summary,
    };
  };

  const executor = async (node: PlanNode, signal: AbortSignal): Promise<NodeExecutionResult> => {
    const startedAt = Date.now();
    logger.info("agent", "orchestration.node-started", {
      runId: initial.runId,
      conversationId: input.conversationId,
      nodeId: node.id,
      nodeKind: node.kind,
      title: node.title,
    });
    const result = await executeNodeInner(node, signal);
    logger.info("agent", "orchestration.node-finished", {
      runId: initial.runId,
      conversationId: input.conversationId,
      nodeId: node.id,
      nodeKind: node.kind,
      status: result.status,
      durationMs: Date.now() - startedAt,
      summary: result.summary.slice(0, 200),
    });
    return result;
  };

  const scheduler = new GraphScheduler(executor, 2, {
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
          { nodeId: node.id },
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
      const events = pendingPlanEvents.splice(0);
      if (!input.privateSession) await repository.persistPlanWithEvents(plan, events);
      const current = useOrchestrationStore.getState().current;
      if (current?.runId === initial.runId)
        useOrchestrationStore.getState().setCurrent({
          ...current,
          plan,
          phase: plan.status === "paused" ? "paused" : "execution",
        });
    },
  });
  activeSchedulers.set(initial.runId, scheduler);
  const abortScheduler = () => scheduler.cancel();
  if (input.signal?.aborted) scheduler.cancel();
  else input.signal?.addEventListener("abort", abortScheduler, { once: true });
  let plan: PlanGraph;
  try {
    plan = await scheduler.run(initial.plan);
    // Dynamic re-plan: a failed step gets one automatic retry revision so the
    // supervisor can recover without losing completed work. The revision is
    // persisted and visible in the execution trace; the goal never changes.
    const failedNodes = plan.nodes.filter(({ status }) => status === "failed");
    if (
      plan.status === "failed" &&
      failedNodes.length > 0 &&
      nodeExecutions <= MAX_REPLAN_NODE_EXECUTIONS &&
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
      const currentSnapshot = useOrchestrationStore.getState().current;
      if (currentSnapshot?.runId === initial.runId) {
        useOrchestrationStore
          .getState()
          .setCurrent({ ...currentSnapshot, plan: revised, phase: "execution" });
      }
      if (!input.privateSession) await repository.persistPlanWithEvents(revised, []);
      plan = await scheduler.run(revised);
    }
  } finally {
    input.signal?.removeEventListener("abort", abortScheduler);
    activeSchedulers.delete(initial.runId);
  }
  if (
    plan.status === "completed" &&
    initial.brief.goalKind !== "answer" &&
    verificationEvidence.size === 0
  ) {
    plan = { ...plan, status: "failed", updatedAt: Date.now() };
  }
  // Final Done-when verification: completed steps never complete the goal by
  // themselves — every executable completion criterion is re-run against the
  // project workspace, and a failing criterion fails the goal.
  if (plan.status === "completed" && (initial.brief.doneWhen?.length ?? 0) > 0) {
    const doneWhenResults = await evaluateDoneWhen(
      initial.brief.doneWhen ?? [],
      input.runtime,
      input.runtime.getWorkspaceRoot?.() ?? null,
    );
    const satisfied = doneWhenSatisfied(doneWhenResults);
    if (!input.privateSession) {
      await repository.persistBrief({ ...initial.brief, doneWhenResults, updatedAt: Date.now() });
    }
    const current = useOrchestrationStore.getState().current;
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
  if (!input.privateSession) await repository.persistPlanWithEvents(plan, [terminalEvent]);
  const current = useOrchestrationStore.getState().current;
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
