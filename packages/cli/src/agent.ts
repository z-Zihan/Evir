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

export async function runAgent(options: {
  config: CliConfig;
  apiKey: string;
  prompt: string;
  workspace: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  approve: (message: string) => Promise<boolean>;
}): Promise<{ content: string; error?: string }> {
  const tools = createWorkspaceTools(options.workspace);
  const definitions = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
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
    if (turn.toolCalls.length === 0) return { content: fullContent };
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
      const key = `${call.name}:${call.arguments}`;
      const count = (repeats.get(key) ?? 0) + 1;
      repeats.set(key, count);
      if (count > 3) return { content: fullContent, error: `Loop detected for ${call.name}` };
      const result = await executeTool(tools, call.name, call.arguments, options);
      messages.push({
        role: "tool",
        content: result,
        tool_call_id: call.id,
        name: call.name,
      });
    }
  }
  return { content: fullContent, error: "Agent reached the 10-step safety limit" };
}

async function executeTool(
  tools: CliTool[],
  name: string,
  rawArguments: string,
  options: {
    signal: AbortSignal;
    approve: (message: string) => Promise<boolean>;
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
      return error instanceof Error ? error.message : "Approval failed";
    }
    if (!approved) return "User denied this tool call";
  }
  try {
    return await tool.execute(args, options.signal);
  } catch (error) {
    return error instanceof Error ? error.message : "Tool execution failed";
  }
}
