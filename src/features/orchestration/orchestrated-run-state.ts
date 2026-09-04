import { createRunEvent, OrchestrationRepository } from "../../core/orchestration/repository";
import type { RunEventV1 } from "../../core/orchestration/types";
import type { AgentAssignment } from "../../core/orchestration/types";
import { goalBudgetExceeded, tokensSpentSince } from "../../core/orchestration/goal-budget";
import type { ProviderRecord } from "../../core/storage/db";
import type { EvirRuntime } from "../../runtime/types";
import {
  runAgentLoop,
  type AgentApprovalContext,
  type AgentLoopResult,
  type AgentMessage,
} from "../chat/agent-loop";
import { ToolRegistryImpl } from "../../core/tools/tool-registry-impl";
import { ToolExecutor } from "../../core/tools/tool-executor";
import type { PlanNode } from "../../core/orchestration/types";
import { useOrchestrationStore } from "./orchestration-store";
import type { OrchestrationSnapshot } from "../../core/orchestration/types";

export interface OrchestratedRunInput {
  provider: ProviderRecord;
  conversationId: string;
  messages: AgentMessage[];
  runtime: EvirRuntime;
  privateSession: boolean;
  onDelta(content: string): void;
  signal?: AbortSignal;
}

/**
 * Shared mutable state for one orchestrated run. Built once by the
 * orchestrator; node execution and lifecycle phases read/write through it
 * instead of closing over locals.
 */
export interface OrchestratedRunState {
  input: OrchestratedRunInput;
  initial: NonNullable<OrchestrationSnapshot>;
  repository: OrchestrationRepository;
  conversationId: string;
  turns: AgentLoopResult["turns"];
  approvalContexts: AgentApprovalContext[];
  completedSummaries: Map<string, string>;
  verificationEvidence: Set<string>;
  pendingPlanEvents: RunEventV1[];
  managerRun: AgentLoopResult["agentRun"];
  nodeExecutions: number;
  runStartedAt: number;
}

/** Event/assignment persistence + store sync helpers for one run. */
export interface OrchestratedRunIo {
  appendEvent(this: void, event: RunEventV1): Promise<void>;
  queuePlanEvent(this: void, event: RunEventV1): void;
  updateAssignment(this: void, assignment: AgentAssignment): Promise<void>;
  budgetBlocked(this: void): Promise<string | null>;
}

export function createRunIo(state: OrchestratedRunState): OrchestratedRunIo {
  const { input, initial, repository, conversationId } = state;
  const appendEvent = async (event: RunEventV1): Promise<void> => {
    if (!input.privateSession) await repository.appendEvent(event);
    const current = useOrchestrationStore.getState().snapshotFor(conversationId);
    if (current?.runId === initial.runId) {
      useOrchestrationStore
        .getState()
        .setCurrent({ ...current, events: [...current.events, event] });
    }
  };

  const queuePlanEvent = (event: RunEventV1): void => {
    state.pendingPlanEvents.push(event);
    const current = useOrchestrationStore.getState().snapshotFor(conversationId);
    if (current?.runId === initial.runId) {
      useOrchestrationStore
        .getState()
        .setCurrent({ ...current, events: [...current.events, event] });
    }
  };

  const updateAssignment = async (assignment: AgentAssignment): Promise<void> => {
    if (!input.privateSession) await repository.persistAssignment(assignment);
    const current = useOrchestrationStore.getState().snapshotFor(conversationId);
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
        state.runStartedAt,
      );
    } catch {
      // Budget checks never break execution when usage is unreadable.
    }
    const reason = goalBudgetExceeded(
      state.nodeExecutions,
      Date.now() - state.runStartedAt,
      tokensSpent,
    );
    if (reason) {
      await appendEvent(createRunEvent("run.blocked", initial.runId, input.conversationId, reason));
      return reason;
    }
    return null;
  };

  return { appendEvent, queuePlanEvent, updateAssignment, budgetBlocked };
}

/**
 * One node's agent loop: scoped tool allowlist, per-node mode, approval
 * context capture, snapshot/file-reference roll-up into the manager run.
 */
export async function executeNodeLoop(
  state: OrchestratedRunState,
  node: PlanNode,
  signal: AbortSignal,
  worker: boolean,
): Promise<AgentLoopResult> {
  const { input, initial, approvalContexts, managerRun, completedSummaries } = state;
  state.nodeExecutions += 1;
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

export function toolsForNode(node: PlanNode, runtime: EvirRuntime): string[] {
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
