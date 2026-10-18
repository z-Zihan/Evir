import type { CliConfig } from "./types";
import { streamProvider } from "./provider-client";
import { createWorkspaceTools, type CliTool } from "./workspace-tools";

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * CLI-2 agent JSONL event contract: with `onEvent`, every lifecycle
 * transition emits one machine-readable line (run-start | step |
 * approval | tool-result | completed | failed) while stdout keeps only the
 * final answer text.
 */
export type AgentEvent =
  | { type: "run-start"; promptChars: number; workspace: string }
  | { type: "step"; step: number }
  | { type: "approval"; tool: string; approved: boolean }
  | { type: "tool-result"; tool: string; ok: boolean }
  | {
      type: "completed";
      steps: number;
      toolCalls: Record<string, number>;
      writes: { ok: number; failed: number };
      verified: boolean;
      elapsedMs: number;
    }
  | { type: "failed"; error: string };

/** Tools whose combined success gates the `completed` event's `verified` flag. */
const VERIFICATION_TOOLS = ["run_command", "git_status", "git_diff"] as const;

/**
 * docs/20 §6.1: every emitted JSON event carries schemaVersion, type,
 * timestamp, and command alongside its payload. The bare `AgentEvent` union
 * above stays unversioned for internal callers; `envelopeEvent` wraps it for
 * anything written to stderr with `--json`.
 */
export interface AgentEventEnvelope {
  schemaVersion: 1;
  timestamp: string;
  command: "agent";
  event: AgentEvent;
}

export function envelopeEvent(event: AgentEvent, command: "agent" = "agent"): AgentEventEnvelope {
  return { schemaVersion: 1, timestamp: new Date().toISOString(), command, event };
}

export async function runAgent(options: {
  config: CliConfig;
  apiKey: string;
  prompt: string;
  workspace: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  approve: (message: string) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ content: string; error?: string }> {
  const startedAt = Date.now();
  options.onEvent?.({
    type: "run-start",
    promptChars: options.prompt.length,
    workspace: options.workspace,
  });
  const tools = createWorkspaceTools(options.workspace);
  const riskByTool = new Map(tools.map((tool) => [tool.name, tool.risk]));
  const definitions = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
  const toolCallCounts: Record<string, number> = {};
  const writes = { ok: 0, failed: 0 };
  const verificationRan: Record<string, boolean> = {};
  const verificationFailed: Record<string, boolean> = {};
  const onEvent = (event: AgentEvent) => {
    if (event.type === "tool-result") {
      if (VERIFICATION_TOOLS.includes(event.tool as (typeof VERIFICATION_TOOLS)[number])) {
        verificationRan[event.tool] = true;
        if (!event.ok) verificationFailed[event.tool] = true;
      }
      if (riskByTool.get(event.tool) !== "read") {
        if (event.ok) writes.ok += 1;
        else writes.failed += 1;
      }
    }
    options.onEvent?.(event);
  };
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: [
        "You are Evir's CLI workspace agent.",
        `Authorized workspace: ${options.workspace}`,
        "Read relevant files before changing them.",
        "Use only relative workspace paths.",
        "Run an appropriate test, check, or build before claiming completion.",
        "Do not claim success when a tool fails or verification is missing.",
      ].join("\n"),
    },
    { role: "user", content: options.prompt },
  ];
  const repeats = new Map<string, number>();
  let fullContent = "";

  for (let step = 0; step < 10; step += 1) {
    onEvent({ type: "step", step });
    const turn = await streamProvider({
      config: options.config,
      apiKey: options.apiKey,
      messages,
      tools: definitions,
      signal: options.signal,
      onDelta: (text) => {
        fullContent += text;
        options.onDelta(text);
      },
    });
    if (turn.error) return { content: fullContent, error: turn.error };
    if (turn.toolCalls.length === 0) {
      const verified = VERIFICATION_TOOLS.every(
        (name) => verificationRan[name] && !verificationFailed[name],
      );
      onEvent({
        type: "completed",
        steps: step + 1,
        toolCalls: toolCallCounts,
        writes,
        verified,
        elapsedMs: Date.now() - startedAt,
      });
      return { content: fullContent };
    }
    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of turn.toolCalls) {
      toolCallCounts[call.name] = (toolCallCounts[call.name] ?? 0) + 1;
      const key = `${call.name}:${call.arguments}`;
      const count = (repeats.get(key) ?? 0) + 1;
      repeats.set(key, count);
      if (count > 3) return { content: fullContent, error: `Loop detected for ${call.name}` };
      const result = await executeTool(tools, call.name, call.arguments, {
        signal: options.signal,
        approve: options.approve,
        onEvent,
      });
      messages.push({
        role: "tool",
        content: result,
        tool_call_id: call.id,
        name: call.name,
      });
    }
  }
  return {
    content: fullContent,
    error: (() => {
      const message = "Agent reached the 10-step safety limit";
      onEvent({ type: "failed", error: message });
      return message;
    })(),
  };
}

async function executeTool(
  tools: CliTool[],
  name: string,
  rawArguments: string,
  options: {
    signal: AbortSignal;
    approve: (message: string) => Promise<boolean>;
    onEvent?: (event: AgentEvent) => void;
  },
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  let args: unknown;
  try {
    args = JSON.parse(rawArguments) as unknown;
  } catch {
    return "Tool arguments must be valid JSON";
  }
  if (tool.risk !== "read") {
    let approved = false;
    try {
      approved = await options.approve(tool.preview(args));
    } catch (error) {
      options.onEvent?.({ type: "approval", tool: name, approved: false });
      return error instanceof Error ? error.message : "Approval failed";
    }
    options.onEvent?.({ type: "approval", tool: name, approved });
    if (!approved) return "User denied this tool call";
  }
  try {
    const output = await tool.execute(args, options.signal);
    options.onEvent?.({ type: "tool-result", tool: name, ok: true });
    return output;
  } catch (error) {
    options.onEvent?.({ type: "tool-result", tool: name, ok: false });
    return error instanceof Error ? error.message : "Tool execution failed";
  }
}
