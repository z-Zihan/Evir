import type { ToolDefinition } from "../../core/providers/tool-registry";
import type { ProviderRecord, ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../../core/tools/tool-executor";
import type { AgentRunContext, EvirRuntime } from "../../runtime/types";
import { streamAssistant, type StreamResult } from "./chat-stream";

export const MAX_AGENT_ITERATIONS = 10;

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

// Loop detection: track repeated tool calls
interface LoopDetector {
  callHistory: Map<string, number>; // key: "toolName:argsHash" → count
  errorHistory: Map<string, number>; // key: error message → count
}

function makeLoopDetector(): LoopDetector {
  return { callHistory: new Map(), errorHistory: new Map() };
}

function toolCallKey(toolName: string, args: Record<string, unknown>): string {
  // Only flag truly identical calls — same tool + same serialized args
  // This is normal in agent loops (e.g. reading multiple files with same tool)
  // Only flag when the EXACT same call (same args) happens many times
  return `${toolName}:${JSON.stringify(args)}`;
}

function checkLoop(
  detector: LoopDetector,
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  const key = toolCallKey(toolName, args);
  const count = (detector.callHistory.get(key) ?? 0) + 1;
  detector.callHistory.set(key, count);
  if (count === 6)
    return `Warning: tool "${toolName}" called with same args twice. Consider a different approach.`;
  if (count >= 12)
    return `Loop detected: tool "${toolName}" called ${count} times with identical args. Stopping.`;
  return null;
}

function trackError(detector: LoopDetector, error: string): string | null {
  const count = (detector.errorHistory.get(error) ?? 0) + 1;
  detector.errorHistory.set(error, count);
  if (count >= 12)
    return `Repeated error ${count} times: "${error}". Stopping to avoid infinite retry.`;
  return null;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const turns: AgentLoopTurn[] = [];
  const messages = [...options.messages];
  const definitions = options.runtime.toolRegistry?.listForMode("agent") ?? [];
  const tools = providerTools(definitions);
  const maximum = options.maxIterations ?? MAX_AGENT_ITERATIONS;
  const agentRun = options.runtime.agentRun ?? {
    id: crypto.randomUUID(),
    snapshots: [],
    fileReferences: [],
  };
  const runtime = { ...options.runtime, mode: "agent" as const, agentRun };
  const loopDetector = makeLoopDetector();

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
      return { turns, maxIterationsReached: false, messages, agentRun };
    }
    // Loop detection: check each tool call
    for (const rawCall of stream.toolCalls) {
      const args = parseArguments(rawCall.arguments) ?? {};
      const warning = checkLoop(loopDetector, rawCall.toolName, args);
      if (warning) {
        if (warning.startsWith("Loop detected")) {
          turns.push({
            stream: { ...stream, content: `${stream.content}\n\n⚠️ ${warning}` },
          });
          return { turns, maxIterationsReached: true, messages, agentRun };
        }
      }
    }
    const { calls, results } = await executeCalls(stream, runtime);
    // Track errors for loop detection
    for (const result of results) {
      if (!result.success && result.error) {
        const errWarning = trackError(loopDetector, result.error);
        if (errWarning) {
          turns.push({
            stream: { ...stream, content: `${stream.content}\n\n⚠️ ${errWarning}` },
          });
          return { turns, maxIterationsReached: true, messages, agentRun };
        }
      }
    }
    const toolCalls = calls.map((c) => c.record);
    const turn: AgentLoopTurn = { stream, toolCalls, toolResults: results };
    if (requiresPermission(results)) {
      const blocked = findBlockedCall(calls, results);
      if (blocked) turn.pendingApproval = blocked;
      turns.push(turn);
      return { turns, maxIterationsReached: false, messages, agentRun };
    }
    appendToolMessages(messages, stream, calls, results);
    turns.push(turn);
  }
  return { turns, maxIterationsReached: true, messages, agentRun };
}

export async function continueAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  return runAgentLoop(options);
}
