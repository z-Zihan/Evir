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
import { streamAssistant, type StreamResult } from "./chat-stream";
import { emitWorkspaceToolEvent } from "../workspace/workspace-events";
import { activeTraceFor } from "../tracing/trace-recorder";

export const MAX_AGENT_ITERATIONS = 12;
export const AGENT_TURN_TIMEOUT_MS = 120_000;

/**
 * Some providers occasionally emit a malformed tool-call name that concatenates
 * the tool id with serialized argument fragments (for example
 * "run_commandprogram</arg_key><arg_value>ls</arg_value>"). When the junk
 * directly follows a known tool id, recover the intended call instead of
 * blocking it as an unknown tool.
 */
export function normalizeToolCallName(name: string, allowedToolIds: Set<string>): string {
  if (allowedToolIds.has(name)) return name;
  const match = [...allowedToolIds]
    .filter((toolId) => name.startsWith(toolId))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) return name;
  logger.info("agent", "agent.tool-name-normalized", {
    rawLength: name.length,
    toolName: match,
  });
  return match;
}

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

interface AgentToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AgentMessage {
  role: string;
  content: unknown;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  name?: string;
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

interface CallWithRaw {
  record: ToolCallRecord;
  rawArguments: string;
}

function providerTools(tools: readonly ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.schema },
  }));
}

function parseArguments(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
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

/** Wire-format mapping shared by the agent loop, approval continuation, and
 * conversation replay. `arguments` must already be a JSON string — callers
 * decide whether to echo the model's raw text or re-serialize a parsed value. */
export function assistantToolCallWireMessage(
  content: string,
  calls: readonly { id: string; toolName: string; arguments: string }[],
): AgentMessage {
  return {
    role: "assistant",
    content,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.toolName, arguments: call.arguments },
    })),
  };
}

export function toolResultWireMessages(results: readonly ToolResultRecord[]): AgentMessage[] {
  return results.map((result) => ({
    role: "tool",
    content: result.output,
    tool_call_id: result.toolCallId,
    name: result.toolName,
  }));
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

function findBlockedCall(
  calls: CallWithRaw[],
  results: ToolResultRecord[],
): { toolCallId: string; toolName: string; args: Record<string, unknown> } | undefined {
  const index = results.findIndex((r) => r.error === TOOL_PERMISSION_REQUIRED);
  if (index === -1) return undefined;
  const call = calls[index];
  return call
    ? { toolCallId: call.record.id, toolName: call.record.toolName, args: call.record.arguments }
    : undefined;
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
  const maximum = options.maxIterations ?? MAX_AGENT_ITERATIONS;
  const MAX_TOOL_NOT_ALLOWED_FEEDBACKS = 2;
  let notAllowedFeedbackCount = 0;
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

  const MAX_STREAM_RETRIES = 2;

  const isTransientStreamError = (stream: StreamResult): boolean =>
    stream.status === "error" &&
    !stream.toolCalls?.length &&
    stream.content.length === 0 &&
    (stream.errorType === "TIMEOUT" || stream.retryable === true);

  const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const timer = globalThis.setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          globalThis.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  for (let iteration = 0; iteration < maximum; iteration += 1) {
    // Transient transport failures (timeout / network / rate limit / 5xx)
    // are retried while nothing has been emitted yet: replaying a request
    // with no consumed deltas or tool calls cannot duplicate side effects.
    // Once any output exists the failure is surfaced to the user instead.
    let stream = await streamAssistant(
      options.provider,
      options.conversationId,
      messages,
      options.onDelta,
      tools,
      options.signal,
      AGENT_TURN_TIMEOUT_MS,
    );
    for (let retry = 0; isTransientStreamError(stream) && retry < MAX_STREAM_RETRIES; retry += 1) {
      if (options.signal?.aborted) break;
      const backoffMs = 1_000 * 2 ** retry;
      activeTraceFor(options.conversationId)?.record("request.retry", {
        status: "error",
        summary: `${stream.errorType ?? "transient"} · retry ${retry + 1}/${MAX_STREAM_RETRIES}`,
      });
      logger.warn("provider", "agent.stream-retry", {
        conversationId: options.conversationId,
        runId: agentRun.id,
        attempt: retry + 1,
        maxRetries: MAX_STREAM_RETRIES,
        errorType: stream.errorType ?? null,
        backoffMs,
      });
      options.onDelta(`\n\n⚠️ 连接暂时失败，正在重试 ${retry + 1}/${MAX_STREAM_RETRIES}…\n`);
      await sleep(backoffMs, options.signal);
      stream = await streamAssistant(
        options.provider,
        options.conversationId,
        messages,
        options.onDelta,
        tools,
        options.signal,
        AGENT_TURN_TIMEOUT_MS,
      );
    }
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
    // Step-scoped denials are fed back as tool results so the model can adapt
    // (for example, describe the change for the Execute node instead of
    // attempting the write inside a read-only node). Loop-style blocks stay
    // hard stops, and repeated denials fall back to blocking the run.
    const disallowedCalls: Array<{
      rawCall: NonNullable<StreamResult["toolCalls"]>[number];
      args: Record<string, unknown>;
      summary: string;
    }> = [];
    for (const rawCall of stream.toolCalls) {
      rawCall.toolName = normalizeToolCallName(rawCall.toolName, allowedToolIds);
      const args = parseArguments(rawCall.arguments) ?? {};
      if (!harness) continue;
      const policy = await harness.dispatch({
        type: "tool-call",
        conversationId: options.conversationId,
        runId: agentRun.id,
        phase: "before-execute",
        mode,
        toolName: rawCall.toolName,
        arguments: args,
        allowedToolIds,
        blocked: false,
      });
      if (!policy.blocked) continue;
      const summary = policy.loopSignal?.summary ?? `Tool not allowed: ${rawCall.toolName}`;
      if (
        policy.loopSignal?.type === "repeated-failed-call" ||
        policy.blockReason !== "tool-not-allowed"
      ) {
        const errorMessageKey =
          policy.loopSignal?.type === "repeated-failed-call"
            ? "tools.repeatedFailures"
            : policy.blockReason === "loop-detected"
              ? "tools.maxIterations"
              : "tools.notAvailable";
        logger.warn("tool", "agent.tool-call-blocked", {
          conversationId: options.conversationId,
          runId: agentRun.id,
          toolName: rawCall.toolName,
          blockReason: policy.blockReason ?? "unknown",
          mode,
          allowedToolIds: [...allowedToolIds],
        });
        turns.push({
          stream: {
            ...stream,
            status: "error",
            errorMessage: errorMessageKey,
            content: `${stream.content}\n\n⚠️ ${summary}`,
          },
        });
        return finish(
          {
            turns,
            maxIterationsReached: policy.blockReason === "loop-detected",
            messages,
            agentRun,
          },
          "blocked",
        );
      }
      logger.warn("tool", "agent.tool-call-blocked", {
        conversationId: options.conversationId,
        runId: agentRun.id,
        toolName: rawCall.toolName,
        blockReason: policy.blockReason ?? "unknown",
        mode,
        allowedToolIds: [...allowedToolIds],
      });
      disallowedCalls.push({ rawCall, args, summary });
    }
    if (disallowedCalls.length > 0) {
      notAllowedFeedbackCount += 1;
      const blockedRecords: ToolCallRecord[] = [];
      const blockedResults: ToolResultRecord[] = [];
      for (const { rawCall, args, summary } of disallowedCalls) {
        blockedRecords.push({ id: rawCall.id, toolName: rawCall.toolName, arguments: args });
        const now = Date.now();
        blockedResults.push({
          toolCallId: rawCall.id,
          toolName: rawCall.toolName,
          success: false,
          output: `${summary}. Do not retry this tool in the current step; continue the task using only the tools allowed here.`,
          error: "tool_not_allowed",
          startedAt: now,
          completedAt: now,
          durationMs: 0,
        });
      }
      const deniedSummary = disallowedCalls.map(({ summary }) => summary).join("；");
      turns.push({
        stream: {
          ...stream,
          content: `${stream.content}\n\n⚠️ ${deniedSummary}`,
        },
        toolCalls: blockedRecords,
        toolResults: blockedResults,
      });
      messages.push(
        assistantToolCallWireMessage(
          stream.content,
          disallowedCalls.map(({ rawCall }) => ({
            id: rawCall.id,
            toolName: rawCall.toolName,
            arguments: rawCall.arguments,
          })),
        ),
      );
      messages.push(...toolResultWireMessages(blockedResults));
      if (notAllowedFeedbackCount > MAX_TOOL_NOT_ALLOWED_FEEDBACKS) {
        turns.push({
          stream: {
            ...stream,
            status: "error",
            errorMessage: "tools.notAllowedByStep",
            content: `${stream.content}\n\n⚠️ ${deniedSummary}`,
          },
        });
        return finish({ turns, maxIterationsReached: false, messages, agentRun }, "blocked");
      }
      continue;
    }
    const { calls, results } = await executeCalls(
      stream,
      runtime,
      allowedToolIds,
      options.conversationId,
      options.signal,
    );
    for (const result of results) {
      if (!harness) continue;
      const loop = await harness.dispatch({
        type: "tool-call",
        conversationId: options.conversationId,
        runId: agentRun.id,
        phase: "after-execute",
        mode,
        result,
        allowedToolIds,
        blocked: false,
      });
      if (loop.blocked) {
        turns.push({
          stream: {
            ...stream,
            status: "error",
            errorMessage: "tools.maxIterations",
            content: `${stream.content}\n\n⚠️ ${loop.loopSignal?.summary ?? "Loop detected"}`,
          },
          toolCalls: calls.map(({ record }) => record),
          toolResults: results,
        });
        return finish({ turns, maxIterationsReached: true, messages, agentRun }, "blocked");
      }
    }
    const toolCalls = calls.map((c) => c.record);
    const turn: AgentLoopTurn = { stream, toolCalls, toolResults: results };
    if (requiresPermission(results)) {
      const blocked = findBlockedCall(calls, results);
      const definition = blocked ? runtime.toolRegistry?.get(blocked.toolName) : undefined;
      if (blocked) {
        turn.pendingApproval = {
          ...blocked,
          ...(definition
            ? {
                riskLevel: definition.riskLevel,
                source: definition.source,
                ...(definition.approval ? { approval: definition.approval } : {}),
              }
            : {}),
          workspaceRoot: runRoot,
        };
      }
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
