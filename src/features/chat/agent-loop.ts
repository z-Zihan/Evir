import type { ToolDefinition } from "../../core/providers/tool-registry";
import type { ProviderRecord, ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../../core/tools/tool-executor";
import type { AgentRunContext, EvirRuntime } from "../../runtime/types";
import { streamAssistant, type StreamResult } from "./chat-stream";

export const MAX_AGENT_ITERATIONS = 12;

export interface AgentLoopTurn {
  stream: StreamResult;
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
  pendingApproval?: { toolCallId: string; toolName: string; args: Record<string, unknown> };
}

export interface AgentLoopOptions {
  provider: ProviderRecord;
  conversationId: string;
  messages: AgentMessage[];
  runtime: EvirRuntime;
  onDelta: (content: string) => void;
  maxIterations?: number;
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

async function executeCalls(
  stream: StreamResult,
  runtime: EvirRuntime,
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
    const result = args
      ? await runtime.toolExecutor?.execute(rawCall.toolName, args, runtime, false)
      : {
          success: false,
          output: "Tool arguments must be a JSON object",
          error: "invalid_arguments",
        };
    results.push({
      toolCallId: rawCall.id,
      toolName: rawCall.toolName,
      ...(result ?? { success: false, output: "Tool executor unavailable", error: "unavailable" }),
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
  messages.push({
    role: "assistant",
    content: stream.content,
    tool_calls: calls.map((call) => ({
      id: call.record.id,
      type: "function" as const,
      function: {
        name: call.record.toolName,
        arguments: call.rawArguments,
      },
    })),
  });
  for (const result of results) {
    messages.push({
      role: "tool",
      content: result.output,
      tool_call_id: result.toolCallId,
      name: result.toolName,
    });
  }
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
  const turns: AgentLoopTurn[] = [];
  const messages = [...options.messages];
  const definitions = options.runtime.toolRegistry?.listForMode("agent") ?? [];
  const tools = providerTools(definitions);
  const allowedToolIds = new Set(definitions.map(({ id }) => id));
  const maximum = options.maxIterations ?? MAX_AGENT_ITERATIONS;
  const agentRun = options.runtime.agentRun ?? {
    id: crypto.randomUUID(),
    snapshots: [],
    fileReferences: [],
  };
  const runtime = { ...options.runtime, mode: "agent" as const, agentRun };
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
        mode: "agent",
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
    return result;
  };

  for (let iteration = 0; iteration < maximum; iteration += 1) {
    const stream = await streamAssistant(
      options.provider,
      options.conversationId,
      messages,
      options.onDelta,
      tools,
    );
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
    for (const rawCall of stream.toolCalls) {
      const args = parseArguments(rawCall.arguments) ?? {};
      if (!harness) continue;
      const policy = await harness.dispatch({
        type: "tool-call",
        conversationId: options.conversationId,
        runId: agentRun.id,
        phase: "before-execute",
        mode: "agent",
        toolName: rawCall.toolName,
        arguments: args,
        allowedToolIds,
        blocked: false,
      });
      if (policy.blocked) {
        const summary = policy.loopSignal?.summary ?? `Tool not allowed: ${rawCall.toolName}`;
        turns.push({
          stream: {
            ...stream,
            status: "error",
            errorMessage:
              policy.blockReason === "loop-detected" ? "tools.maxIterations" : "tools.notAvailable",
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
    }
    const { calls, results } = await executeCalls(stream, runtime);
    for (const result of results) {
      if (!harness) continue;
      const loop = await harness.dispatch({
        type: "tool-call",
        conversationId: options.conversationId,
        runId: agentRun.id,
        phase: "after-execute",
        mode: "agent",
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
      if (blocked) turn.pendingApproval = blocked;
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
