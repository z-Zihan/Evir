import type { Capability, EvirRuntime } from "../../runtime/types";

export type { Capability };

export type ToolSource = "evir-local" | "mcp-local" | "mcp-remote" | "provider-server";

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  /**
   * Set when the tool ran an external process that completed and reported a
   * programmatic outcome. The command's exit code is honest data for the
   * model (success stays false on non-zero); it is distinct from the tool
   * itself failing to execute.
   */
  exitCode?: number;
}

export interface ToolApprovalDetails {
  target: string;
  impact: "local-process-access" | "remote-data-transfer";
  reversible: boolean;
  dataDestination?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  source: ToolSource;
  riskLevel: RiskLevel;
  requiredCapability?: Capability;
  approval?: ToolApprovalDetails;
  schema: Record<string, unknown>;
  execute(
    args: Record<string, unknown>,
    runtime: EvirRuntime,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(toolId: string): void;
  get(toolId: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
  listBySource(source: ToolSource): readonly ToolDefinition[];
  listByRiskLevel(maxLevel: RiskLevel): readonly ToolDefinition[];
  listForMode(mode: InteractionMode): readonly ToolDefinition[];
}

export type InteractionMode = "ask" | "plan" | "goal" | "agent";

// Single source of truth for the full mode set — zod enums (e.g. checkpoints)
// derive from this tuple so a new mode cannot be added to the union alone.
export const INTERACTION_MODES = ["ask", "plan", "goal", "agent"] as const;

// Modes whose execution path issues tool calls to the provider. Every special
// mode runs tools (plan = L1 read-only, agent/goal = full loop), so they all
// require a tool-calling model; text-only models are downgraded to ask by
// effectiveModeForModel before reaching the stream.
export const MODES_REQUIRING_TOOL_CALLING = ["plan", "goal", "agent"] as const;

export function requiresToolCalling(mode: InteractionMode): boolean {
  return (MODES_REQUIRING_TOOL_CALLING as readonly string[]).includes(mode);
}

export const RISK_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const satisfies readonly RiskLevel[];

export const TOOL_SOURCES = [
  "evir-local",
  "mcp-local",
  "mcp-remote",
  "provider-server",
] as const satisfies readonly ToolSource[];

export const MODE_TOOL_RISK_LIMITS: Record<InteractionMode, RiskLevel> = {
  ask: "L0",
  plan: "L1",
  goal: "L4",
  agent: "L4",
};
