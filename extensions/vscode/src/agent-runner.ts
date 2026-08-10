import type { ProviderConfig } from "./types";
import type { ProviderClient } from "./provider-client";
import type { ExtensionTool, ToolRisk, WorkspaceTools } from "./workspace-tools";

export interface ApprovalRequest {
  title: string;
  detail: string;
  risk: Extract<ToolRisk, "write" | "execute">;
}

export interface AgentResult {
  content: string;
  stopped: boolean;
  error?: string;
}

interface ModelMessage {
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

export class AgentRunner {
  constructor(
    private readonly provider: Pick<ProviderClient, "stream">,
    private readonly workspaceTools: Pick<WorkspaceTools, "list">,
  ) {}

  async run(options: {
    config: ProviderConfig;
    apiKey: string;
    history: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
    workspaceNames: string[];
    signal: AbortSignal;
    onDelta: (content: string) => void;
    requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  }): Promise<AgentResult> {
    const tools = this.workspaceTools.list();
    const definitions = tools.map(toProviderTool);
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: systemInstruction(options.workspaceNames),
      },
      ...options.history.map((message) => ({ ...message })),
    ];
    const repeatedCalls = new Map<string, number>();
    let visible = "";
    let changedWorkspace = false;
    let successfulCommands = 0;

    for (let iteration = 0; iteration < 10; iteration += 1) {
      if (options.signal.aborted) return { content: visible, stopped: true };
      const beforeTurn = visible;
      const turn = await this.provider.stream(
        options.config,
        options.apiKey,
        messages,
        definitions,
        options.signal,
        (turnContent) => options.onDelta(joinVisible(beforeTurn, turnContent)),
      );
      visible = joinVisible(visible, turn.content);
      if (turn.error) {
        return { content: visible, stopped: options.signal.aborted, error: turn.error };
      }
      if (turn.toolCalls.length === 0) {
        const verification = await this.verificationSummary(
          tools,
          changedWorkspace,
          successfulCommands,
          options.signal,
        );
        const completed = joinVisible(visible, verification);
        options.onDelta(completed);
        return { content: completed, stopped: false };
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
        const loopKey = `${call.name}:${call.arguments}`;
        const count = (repeatedCalls.get(loopKey) ?? 0) + 1;
        repeatedCalls.set(loopKey, count);
        if (count > 3) {
          return {
            content: visible,
            stopped: false,
            error: `Loop detected: ${call.name} was requested repeatedly with identical arguments.`,
          };
        }
        const result = await this.executeTool(
          tools,
          call.name,
          call.arguments,
          options.signal,
          options.requestApproval,
        );
        if (result.changed) changedWorkspace = true;
        if (result.commandSucceeded) successfulCommands += 1;
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: call.id,
          name: call.name,
        });
      }
    }
    return {
      content: visible,
      stopped: false,
      error: "Agent reached the 10-step safety limit before producing a final response.",
    };
  }

  private async executeTool(
    tools: ExtensionTool[],
    name: string,
    rawArguments: string,
    signal: AbortSignal,
    requestApproval: (request: ApprovalRequest) => Promise<boolean>,
  ): Promise<{ content: string; changed: boolean; commandSucceeded: boolean }> {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return result(`Unknown tool: ${name}`);
    let args: unknown;
    try {
      args = JSON.parse(rawArguments) as unknown;
    } catch {
      return result("Tool arguments must be valid JSON.");
    }
    if (tool.risk !== "read") {
      const approved = await requestApproval({
        title: tool.name,
        detail: approvalDetail(tool, args),
        risk: tool.risk,
      });
      if (!approved) return result("User denied this tool call.");
    }
    try {
      const content = await tool.execute(args, signal);
      return {
        content,
        changed: tool.risk === "write",
        commandSucceeded: tool.risk === "execute",
      };
    } catch (error) {
      return result(error instanceof Error ? error.message : "Tool execution failed.");
    }
  }

  private async verificationSummary(
    tools: ExtensionTool[],
    changed: boolean,
    successfulCommands: number,
    signal: AbortSignal,
  ): Promise<string> {
    if (!changed && successfulCommands === 0) return "";
    const evidence: string[] = [];
    if (changed) {
      const gitStatus = tools.find((tool) => tool.name === "git_status");
      try {
        const status = await gitStatus?.execute({}, signal);
        evidence.push(status?.trim() ? `Git status:\n${status.trim()}` : "Git status is clean.");
      } catch (error) {
        evidence.push(
          `Git status unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    evidence.push(
      successfulCommands > 0
        ? `${successfulCommands} approved verification or workspace command(s) completed successfully.`
        : "No command-based verification was completed.",
    );
    return `Verification evidence:\n${evidence.join("\n")}`;
  }
}

function toProviderTool(tool: ExtensionTool): unknown {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function systemInstruction(workspaceNames: string[]): string {
  return [
    "You are Evir's VS Code workspace agent.",
    `Authorized workspace folders: ${workspaceNames.join(", ")}.`,
    "Use tools only when needed to satisfy the user's request.",
    "Never guess file contents. Read relevant files before modifying them.",
    "All paths must be relative to an authorized workspace folder.",
    "Prefer targeted edits. write_file replaces a complete file, so preserve unrelated content.",
    "Run an appropriate check, test, or build before claiming a code task is complete.",
    "Do not claim success when a tool failed or verification was not performed.",
  ].join("\n");
}

function approvalDetail(tool: ExtensionTool, args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "Invalid arguments";
  const record = args as Record<string, unknown>;
  if (tool.risk === "execute") {
    const program = typeof record.program === "string" ? record.program : "unknown";
    const commandArgs = Array.isArray(record.args) ? record.args.map(String) : [];
    return `Run in the selected workspace:\n${[program, ...commandArgs].join(" ")}`;
  }
  const target = typeof record.path === "string" ? record.path : "unknown path";
  const content = typeof record.content === "string" ? record.content : "";
  const preview = content.length > 1000 ? `${content.slice(0, 1000)}\n…` : content;
  return `Replace ${target} (${content.length} characters)\n\n${preview}`;
}

function joinVisible(existing: string, addition: string): string {
  if (!addition) return existing;
  return existing ? `${existing}\n\n${addition}` : addition;
}

function result(content: string) {
  return { content, changed: false, commandSucceeded: false };
}
