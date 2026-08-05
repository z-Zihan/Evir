import type { ToolDefinition } from "../../core/providers/tool-registry";
import type { ProviderRecord, ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../../core/tools/tool-executor";
import type { EvirRuntime } from "../../runtime/types";
import { streamAssistant, type StreamResult } from "./chat-stream";

export const MAX_AGENT_ITERATIONS = 10;

export interface AgentLoopTurn {
  stream: StreamResult;
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
}

interface AgentLoopOptions {
  provider: ProviderRecord;
  conversationId: string;
  messages: AgentMessage[];
  runtime: EvirRuntime;
  onDelta: (content: string) => void;
  maxIterations?: number;
}

interface AgentMessage {
  role: string;
  content: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentLoopResult {
  turns: AgentLoopTurn[];
  maxIterationsReached: boolean;
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
): Promise<{ calls: ToolCallRecord[]; results: ToolResultRecord[] }> {
  const calls: ToolCallRecord[] = [];
  const results: ToolResultRecord[] = [];
  for (const rawCall of stream.toolCalls ?? []) {
    const args = parseArguments(rawCall.arguments);
    calls.push({ id: rawCall.id, toolName: rawCall.toolName, arguments: args ?? {} });
    const result = args
      ? await runtime.toolExecutor?.execute(rawCall.toolName, args, runtime)
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
  calls: ToolCallRecord[],
  results: ToolResultRecord[],
): void {
  messages.push({
    role: "assistant",
    content: stream.content,
    tool_calls: calls.map((call, index) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.toolName,
        arguments: stream.toolCalls?.[index]?.arguments ?? JSON.stringify(call.arguments),
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

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const turns: AgentLoopTurn[] = [];
  const messages = [...options.messages];
  const definitions = options.runtime.toolRegistry?.listForMode("agent") ?? [];
  const tools = providerTools(definitions);
  const maximum = options.maxIterations ?? MAX_AGENT_ITERATIONS;
  const runtime = { ...options.runtime, mode: "agent" as const };

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
      return { turns, maxIterationsReached: false };
    }
    const { calls, results } = await executeCalls(stream, runtime);
    turns.push({ stream, toolCalls: calls, toolResults: results });
    if (requiresPermission(results)) return { turns, maxIterationsReached: false };
    appendToolMessages(messages, stream, calls, results);
    options.onDelta("");
  }
  return { turns, maxIterationsReached: true };
}
