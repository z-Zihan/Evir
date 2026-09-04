import type {
  RiskLevel,
  ToolApprovalDetails,
  ToolDefinition,
  ToolSource,
} from "../../core/providers/tool-registry";
import type { ProviderRecord, ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { getActiveWorkspaceRoot, popRunRoot, pushRunRoot } from "../../core/workspace/active-root";
import { TOOL_PERMISSION_REQUIRED } from "../../core/tools/tool-executor";
import { logger } from "../../core/logging/logger";
import type { PermissionContext } from "../../core/security/permission-profiles";
import { permissionContextForRoot } from "../projects/run-permission";
import type { AgentRunContext, EvirRuntime } from "../../runtime/types";
import type { InteractionMode } from "../../core/providers/tool-registry";
import type { StreamResult } from "./chat-stream";
import { emitWorkspaceToolEvent } from "../workspace/workspace-events";
import { activeTraceFor } from "../tracing/trace-recorder";
import {
  buildPendingApproval,
  detectPostExecuteLoop,
  feedbackDeniedCalls,
  gateToolCalls,
  streamWithRetry,
  type LoopExecution,
} from "./agent-loop-phases";

export const MAX_AGENT_ITERATIONS = 12;

// Shared loop protocol lives in a leaf module so agent-loop-phases can import
// it without closing a runtime cycle; re-exported here for existing importers.
import {
  assistantToolCallWireMessage,
  parseArguments,
  toolResultWireMessages,
  type AgentMessage,
  type CallWithRaw,
} from "./agent-loop-protocol";
export {
  AGENT_TURN_TIMEOUT_MS,
  assistantToolCallWireMessage,
  findBlockedCall,
  normalizeToolCallName,
  parseArguments,
  toolResultWireMessages,
} from "./agent-loop-protocol";
export type { AgentMessage, AgentToolCall, CallWithRaw } from "./agent-loop-protocol";

export interface AgentLoopTurn {
  stream: StreamResult;
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
  pendingApproval?: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    riskLevel?: RiskLevel;
    source?: ToolSource;
    approval?: ToolApprovalDetails;
    /** Workspace root captured when the run started; approval continuations rebind to it. */
    workspaceRoot?: string | null;
  };
}

export interface AgentLoopOptions {
  provider: ProviderRecord;
  conversationId: string;
  messages: AgentMessage[];
  runtime: EvirRuntime;
  onDelta: (content: string) => void;
  maxIterations?: number;
  mode?: InteractionMode;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  turns: AgentLoopTurn[];
  maxIterationsReached: boolean;
  messages: AgentMessage[];
  agentRun: AgentRunContext;
  approvalContexts?: AgentApprovalContext[];
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface AgentApprovalContext {
  runId: string;
  nodeId: string;
  mode: InteractionMode;
  allowedToolIds: string[];
  messages: AgentMessage[];
  turn: AgentLoopTurn;
  agentRun: AgentRunContext;
}

function providerTools(tools: readonly ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.schema },
  }));
}

/** Metadata-only tool summaries for traces (§25): keys/sizes, never values. */
function summarizeToolArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  return keys.length > 0
    ? `args: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "…" : ""}`
    : "args: none";
}

function summarizeToolOutput(output: string | undefined): string {
  if (output === undefined) return "no output";
  const lines = output.split("\n").length;
  return `${output.length} chars · ${lines} line${lines === 1 ? "" : "s"}`;
}

async function executeCalls(
  stream: StreamResult,
  runtime: EvirRuntime,
  allowedToolIds: ReadonlySet<string>,
  conversationId: string,
  signal?: AbortSignal,
): Promise<{ calls: CallWithRaw[]; results: ToolResultRecord[] }> {
  const calls: CallWithRaw[] = [];
  const results: ToolResultRecord[] = [];
  for (const rawCall of stream.toolCalls ?? []) {
    const args = parseArguments(rawCall.arguments);
    const record: ToolCallRecord = {
      id: rawCall.id,
      toolName: rawCall.toolName,
      arguments: args ?? {},
    };
    calls.push({ record, rawArguments: rawCall.arguments });
    const startedAt = Date.now();
    const trace = activeTraceFor(conversationId);
    trace?.toolStarted(rawCall.id, rawCall.toolName);
    logger.info("tool", "agent.tool-started", {
      conversationId,
      runId: runtime.agentRun?.id,
      toolCallId: rawCall.id,
      toolName: rawCall.toolName,
    });
    logger.debug("tool", "executor.loop-before", { toolName: rawCall.toolName });
    const snapshotsBefore = runtime.agentRun ? runtime.agentRun.snapshots.length : 0;
    const result = !allowedToolIds.has(rawCall.toolName)
      ? {
          success: false,
          output: "Tool is not available in this execution scope",
          error: "tool_not_allowed",
        }
      : args
        ? await runtime.toolExecutor?.execute(rawCall.toolName, args, runtime, false, signal, {
            conversationId,
            runId: runtime.agentRun?.id ?? null,
            toolCallId: rawCall.id,
          })
        : {
            success: false,
            output: "Tool arguments must be a JSON object",
            error: "invalid_arguments",
          };
    const completedAt = Date.now();
    trace?.toolSettled(rawCall.id, {
      success: Boolean(result?.success),
      durationMs: completedAt - startedAt,
      ...(result?.error ? { errorCategory: result.error } : {}),
      // Metadata-only summaries (§25): argument/result shapes, never payloads.
      inputSummary: summarizeToolArgs(record.arguments),
      outputSummary: summarizeToolOutput(result?.output),
    });
    logger.debug("tool", "executor.loop-after", {
      toolName: rawCall.toolName,
      success: result?.success,
      error: result?.error ?? null,
      durationMs: completedAt - startedAt,
    });
    const timedResult: ToolResultRecord = {
      toolCallId: rawCall.id,
      toolName: rawCall.toolName,
      ...(result ?? { success: false, output: "Tool executor unavailable", error: "unavailable" }),
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    };
    results.push(timedResult);
    // Real-time workspace panels (Changes/Files/Outputs) subscribe to this
    // in-process bus; a listener crash must never affect the loop itself.
    emitWorkspaceToolEvent({
      conversationId,
      runId: runtime.agentRun?.id ?? null,
      toolCall: record,
      result: timedResult,
      newSnapshots: runtime.agentRun ? runtime.agentRun.snapshots.slice(snapshotsBefore) : [],
    });
    logger.info("tool", "agent.tool-completed", {
      conversationId,
      runId: runtime.agentRun?.id,
      toolCallId: rawCall.id,
      toolName: rawCall.toolName,
      success: timedResult.success,
      durationMs: timedResult.durationMs,
      error: timedResult.error ?? null,
    });
  }
  return { calls, results };
}

function appendToolMessages(
  messages: AgentMessage[],
  stream: StreamResult,
  calls: CallWithRaw[],
  results: ToolResultRecord[],
): void {
  messages.push(
    assistantToolCallWireMessage(
      stream.content,
      calls.map((call) => ({
        id: call.record.id,
        toolName: call.record.toolName,
        arguments: call.rawArguments,
      })),
    ),
  );
  messages.push(...toolResultWireMessages(results));
}

function requiresPermission(results: ToolResultRecord[]): boolean {
  return results.some((result) => result.error === TOOL_PERMISSION_REQUIRED);
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  // Bind the workspace root and permission context for the whole run: sidebar
  // project switches change the live resolver but must never affect an active
  // run.
  const runRoot = getActiveWorkspaceRoot();
  const permissionContext = permissionContextForRoot(runRoot);
  pushRunRoot(runRoot, permissionContext);
  try {
    return await runAgentLoopBound(options, permissionContext);
  } finally {
    popRunRoot();
  }
}

async function runAgentLoopBound(
  options: AgentLoopOptions,
  permissionContext: PermissionContext | null,
): Promise<AgentLoopResult> {
  const runRoot = getActiveWorkspaceRoot();
  const startedAt = Date.now();
  const turns: AgentLoopTurn[] = [];
  const messages = [...options.messages];
  // Goal runs share the agent tool profile; the distinction lives above the loop.
  const mode: Exclude<InteractionMode, "goal"> = options.mode === "plan" ? "plan" : "agent";
  if (mode === "agent" && options.runtime.getMcpRuntime) {
    await (await options.runtime.getMcpRuntime()).activatePersisted();
  }
  const definitions = options.runtime.toolRegistry?.listForMode(mode) ?? [];
  const tools = providerTools(definitions);
  const allowedToolIds = new Set(definitions.map(({ id }) => id));
  const agentRun = options.runtime.agentRun ?? {
    id: crypto.randomUUID(),
    snapshots: [],
    fileReferences: [],
    startedMode: options.mode ?? "agent",
  };
  activeTraceFor(options.conversationId)?.attachRun(agentRun.id);
  const runtime = { ...options.runtime, mode, agentRun, permissionContext };
  const harness = runtime.harnessMiddlewareRegistry;
  if (harness) {
    await harness.dispatch({
      type: "run-lifecycle",
      conversationId: options.conversationId,
      runId: agentRun.id,
      phase: "start",
    });
  }
  const finish = async (
    result: AgentLoopResult,
    status: "completed" | "stopped" | "failed" | "blocked",
  ): Promise<AgentLoopResult> => {
    if (harness) {
      await harness.dispatch({
        type: "tool-call",
        conversationId: options.conversationId,
        runId: agentRun.id,
        phase: "run-end",
        mode,
        allowedToolIds,
        blocked: false,
      });
      await harness.dispatch({
        type: "run-lifecycle",
        conversationId: options.conversationId,
        runId: agentRun.id,
        phase: "end",
        status,
      });
    }
    const completedAt = Date.now();
    return { ...result, startedAt, completedAt, durationMs: completedAt - startedAt };
  };

  const loop: LoopExecution = {
    options,
    runtime,
    harness,
    mode,
    allowedToolIds,
    agentRun,
    turns,
    messages,
    runRoot,
  };

  for (
    let iteration = 0;
    iteration < (options.maxIterations ?? MAX_AGENT_ITERATIONS);
    iteration += 1
  ) {
    const stream = await streamWithRetry(loop, messages, tools);
    if (stream.status !== "complete" || !stream.toolCalls?.length) {
      turns.push({ stream });
      return finish(
        { turns, maxIterationsReached: false, messages, agentRun },
        stream.status === "complete"
          ? "completed"
          : stream.status === "stopped"
            ? "stopped"
            : "failed",
      );
    }

    const gate = await gateToolCalls(loop, stream);
    if (gate.hardBlock) {
      return finish(gate.hardBlock.result, "blocked");
    }
    if (gate.disallowedCalls.length > 0) {
      const denied = feedbackDeniedCalls(loop, stream, gate.disallowedCalls);
      if (denied.hardBlock) return finish(denied.hardBlock, "blocked");
      continue;
    }

    const { calls, results } = await executeCalls(
      stream,
      runtime,
      allowedToolIds,
      options.conversationId,
      options.signal,
    );
    const loopBlock = await detectPostExecuteLoop(loop, stream, calls, results);
    if (loopBlock) {
      return finish(loopBlock, "blocked");
    }

    const turn: AgentLoopTurn = {
      stream,
      toolCalls: calls.map((c) => c.record),
      toolResults: results,
    };
    if (requiresPermission(results)) {
      const pendingApproval = buildPendingApproval(loop, calls, results, runRoot);
      if (pendingApproval) turn.pendingApproval = pendingApproval;
      turns.push(turn);
      return finish({ turns, maxIterationsReached: false, messages, agentRun }, "blocked");
    }
    appendToolMessages(messages, stream, calls, results);
    turns.push(turn);
  }
  return finish({ turns, maxIterationsReached: true, messages, agentRun }, "failed");
}

export async function continueAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  return runAgentLoop(options);
}
