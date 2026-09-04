import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { logger } from "../../core/logging/logger";
import type { AgentRunContext, EvirRuntime } from "../../runtime/types";
import type { InteractionMode } from "../../core/providers/tool-registry";
import { streamAssistant, type StreamResult } from "./chat-stream";
import { activeTraceFor } from "../tracing/trace-recorder";
import {
  AGENT_TURN_TIMEOUT_MS,
  assistantToolCallWireMessage,
  findBlockedCall,
  normalizeToolCallName,
  parseArguments,
  toolResultWireMessages,
  type AgentMessage,
  type CallWithRaw,
} from "./agent-loop-protocol";
import type { AgentLoopOptions, AgentLoopResult, AgentLoopTurn } from "./agent-loop";

/** Mutable execution state shared by the loop's extracted phases. */
export interface LoopExecution {
  options: AgentLoopOptions;
  runtime: EvirRuntime & { mode: Exclude<InteractionMode, "goal"> };
  harness: EvirRuntime["harnessMiddlewareRegistry"];
  mode: Exclude<InteractionMode, "goal">;
  allowedToolIds: Set<string>;
  agentRun: AgentRunContext;
  turns: AgentLoopTurn[];
  messages: AgentMessage[];
  runRoot: string | null;
}

const MAX_STREAM_RETRIES = 2;
const MAX_TOOL_NOT_ALLOWED_FEEDBACKS = 2;
/** Soft-denial feedback budget is loop-scoped state, carried on the context. */
const notAllowedFeedbackCounts = new WeakMap<LoopExecution, number>();

function isTransientStreamError(stream: StreamResult): boolean {
  return (
    stream.status === "error" &&
    !stream.toolCalls?.length &&
    stream.content.length === 0 &&
    (stream.errorType === "TIMEOUT" || stream.retryable === true)
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
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
}

/**
 * One model request with transient-failure retry: transport errors are
 * retried while nothing has been emitted yet (replaying a request with no
 * consumed deltas or tool calls cannot duplicate side effects). Once any
 * output exists the failure is surfaced to the user instead.
 */
export async function streamWithRetry(
  loop: LoopExecution,
  messages: AgentMessage[],
  tools: unknown[],
): Promise<StreamResult> {
  const { options, agentRun } = loop;
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
  return stream;
}

export interface DisallowedCall {
  rawCall: NonNullable<StreamResult["toolCalls"]>[number];
  args: Record<string, unknown>;
  summary: string;
}

export interface GateResult {
  /** Hard stop (loop detection / repeated failures / policy): run is blocked. */
  hardBlock?: { result: AgentLoopResult };
  /** Soft denials fed back to the model as tool results. */
  disallowedCalls: DisallowedCall[];
}

/**
 * Before-execute tool policy gate. Classifies each blocked call as a hard
 * stop (loop-style blocks, repeated failed calls) or a soft step-scoped
 * denial the model can adapt to.
 */
export async function gateToolCalls(
  loop: LoopExecution,
  stream: StreamResult,
): Promise<GateResult> {
  const { options, harness, mode, allowedToolIds, agentRun, turns, messages } = loop;
  const disallowedCalls: DisallowedCall[] = [];
  for (const rawCall of stream.toolCalls ?? []) {
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
      return {
        hardBlock: {
          result: {
            turns,
            maxIterationsReached: policy.blockReason === "loop-detected",
            messages,
            agentRun,
          },
        },
        disallowedCalls: [],
      };
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
  return { disallowedCalls };
}

/**
 * Step-scoped denials are fed back as tool results so the model can adapt
 * (for example, describe the change for the Execute node instead of
 * attempting the write inside a read-only node). Repeated denials fall back
 * to blocking the run.
 */
export function feedbackDeniedCalls(
  loop: LoopExecution,
  stream: StreamResult,
  disallowedCalls: DisallowedCall[],
): { hardBlock?: AgentLoopResult } {
  const { turns, messages, agentRun } = loop;
  const notAllowedFeedbackCount = (notAllowedFeedbackCounts.get(loop) ?? 0) + 1;
  notAllowedFeedbackCounts.set(loop, notAllowedFeedbackCount);
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
    return { hardBlock: { turns, maxIterationsReached: false, messages, agentRun } };
  }
  return {};
}

/** After-execute loop detection over the executed tool results. */
export async function detectPostExecuteLoop(
  loop: LoopExecution,
  stream: StreamResult,
  calls: CallWithRaw[],
  results: ToolResultRecord[],
): Promise<AgentLoopResult | null> {
  const { options, harness, mode, allowedToolIds, agentRun, turns, messages } = loop;
  for (const result of results) {
    if (!harness) continue;
    const policy = await harness.dispatch({
      type: "tool-call",
      conversationId: options.conversationId,
      runId: agentRun.id,
      phase: "after-execute",
      mode,
      result,
      allowedToolIds,
      blocked: false,
    });
    if (policy.blocked) {
      turns.push({
        stream: {
          ...stream,
          status: "error",
          errorMessage: "tools.maxIterations",
          content: `${stream.content}\n\n⚠️ ${policy.loopSignal?.summary ?? "Loop detected"}`,
        },
        toolCalls: calls.map(({ record }) => record),
        toolResults: results,
      });
      return { turns, maxIterationsReached: true, messages, agentRun };
    }
  }
  return null;
}

/** Approval payload for the first permission-blocked call in the results. */
export function buildPendingApproval(
  loop: LoopExecution,
  calls: CallWithRaw[],
  results: ToolResultRecord[],
  runRoot: string | null,
): AgentLoopTurn["pendingApproval"] {
  const blocked = findBlockedCall(calls, results);
  if (!blocked) return undefined;
  const definition = loop.runtime.toolRegistry?.get(blocked.toolName);
  return {
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
