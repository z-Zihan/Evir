import { AgentDispatcher, restrictTools } from "../../core/orchestration/agent-dispatcher";
import { createRunEvent } from "../../core/orchestration/repository";
import { GraphScheduler, type NodeExecutionResult } from "../../core/orchestration/scheduler";
import type {
  AgentAssignment,
  PlanGraph,
  PlanNode,
  WorkerReport,
} from "../../core/orchestration/types";
import { popRunRoot, pushRunRoot } from "../../core/workspace/active-root";
import { permissionContextForRoot } from "../projects/run-permission";
import type { AgentLoopResult } from "../chat/agent-loop";
import { logger } from "../../core/logging/logger";
import { applyVerificationVerdict } from "./verification-verdict";
import { useOrchestrationStore } from "./orchestration-store";
import {
  executeNodeLoop,
  toolsForNode,
  type OrchestratedRunIo,
  type OrchestratedRunState,
} from "./orchestrated-run-state";

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

export function loopSummary(result: AgentLoopResult): string {
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

export function eventForResult(result: NodeExecutionResult) {
  if (result.status === "completed") return "node.completed" as const;
  if (result.status === "blocked") return "node.blocked" as const;
  return "node.failed" as const;
}

/**
 * One plan node, dispatched by kind: structural nodes (approval/join/
 * subgraph) resolve without a model call; plain nodes run the scoped agent
 * loop; subagent nodes run isolated (optionally in a git worktree) with
 * assignment tracking and merge-back.
 */
export async function executeNode(
  state: OrchestratedRunState,
  io: OrchestratedRunIo,
  node: PlanNode,
  signal: AbortSignal,
  runExecutor: (node: PlanNode, signal: AbortSignal) => Promise<NodeExecutionResult>,
): Promise<NodeExecutionResult> {
  const startedAt = Date.now();
  logger.info("agent", "orchestration.node-started", {
    runId: state.initial.runId,
    conversationId: state.input.conversationId,
    nodeId: node.id,
    nodeKind: node.kind,
    title: node.title,
  });
  const result = await executeNodeInner(state, io, node, signal, runExecutor);
  logger.info("agent", "orchestration.node-finished", {
    runId: state.initial.runId,
    conversationId: state.input.conversationId,
    nodeId: node.id,
    nodeKind: node.kind,
    status: result.status,
    durationMs: Date.now() - startedAt,
    summary: result.summary.slice(0, 200),
  });
  return result;
}

async function executeNodeInner(
  state: OrchestratedRunState,
  io: OrchestratedRunIo,
  node: PlanNode,
  signal: AbortSignal,
  runExecutor: (node: PlanNode, signal: AbortSignal) => Promise<NodeExecutionResult>,
): Promise<NodeExecutionResult> {
  const { completedSummaries, verificationEvidence, turns } = state;
  const { budgetBlocked } = io;
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
    return executeSubgraphNode(state, io, node, runExecutor);
  }
  if (node.kind !== "subagent") {
    const budgetReason = await budgetBlocked();
    if (budgetReason) return { status: "blocked", summary: budgetReason };
    const result = await executeNodeLoop(state, node, signal, false);
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
  return executeSubagentNode(state, io, node, signal);
}

async function executeSubgraphNode(
  state: OrchestratedRunState,
  io: OrchestratedRunIo,
  node: PlanNode,
  runExecutor: (node: PlanNode, signal: AbortSignal) => Promise<NodeExecutionResult>,
): Promise<NodeExecutionResult> {
  const { input, initial, completedSummaries } = state;
  const { appendEvent } = io;
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
  const nested = await new GraphScheduler(runExecutor, 2, {
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

async function executeSubagentNode(
  state: OrchestratedRunState,
  io: OrchestratedRunIo,
  node: PlanNode,
  signal: AbortSignal,
): Promise<NodeExecutionResult> {
  const { input, initial, approvalContexts, turns, completedSummaries } = state;
  const { appendEvent, updateAssignment, budgetBlocked } = io;
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
        result = await executeNodeLoop(state, node, workerSignal, true);
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
}
