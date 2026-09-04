/**
 * Leaf protocol module for the agent loop family: the wire types and helper
 * functions shared by `agent-loop`, `agent-loop-phases`, approval continuation
 * and conversation replay. Living here (instead of agent-loop.ts) keeps the
 * loop ⇄ phases relationship acyclic at runtime (§circular-dependency
 * governance).
 */
import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import { TOOL_PERMISSION_REQUIRED } from "../../core/tools/tool-executor";
import { logger } from "../../core/logging/logger";

export const AGENT_TURN_TIMEOUT_MS = 120_000;

export interface AgentToolCall {
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

export interface CallWithRaw {
  record: ToolCallRecord;
  rawArguments: string;
}

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

export function parseArguments(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
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

export function findBlockedCall(
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
