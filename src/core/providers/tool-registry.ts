import type { Capability, EvirRuntime } from "../../runtime/types";

export type { Capability };

export type ToolSource = "evir-local" | "mcp-local" | "mcp-remote" | "provider-server";

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
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

export type InteractionMode = "ask" | "plan" | "agent";

export const MODE_TOOL_RISK_LIMITS: Record<InteractionMode, RiskLevel> = {
  ask: "L0",
  plan: "L1",
  agent: "L4",
};
