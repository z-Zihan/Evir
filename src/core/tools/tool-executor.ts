import {
  MODE_TOOL_RISK_LIMITS,
  type ToolRegistry,
  type ToolResult,
} from "../providers/tool-registry";
import type { EvirRuntime } from "../../runtime/types";
import { riskLevelExceeds } from "./tool-registry-impl";

export const TOOL_PERMISSION_REQUIRED = "permission_required";
export const TOOL_NOT_AVAILABLE = "not_available_in_browser";

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    runtime: EvirRuntime,
  ): Promise<ToolResult> {
    const tool =
      this.registry.get(toolName) ?? this.registry.list().find((item) => item.name === toolName);
    if (!tool) return failure(`Unknown tool: ${toolName}`, "tool_not_found");

    const mode = runtime.mode ?? "ask";
    if (riskLevelExceeds(tool.riskLevel, MODE_TOOL_RISK_LIMITS[mode])) {
      return failure(`Tool ${toolName} is not allowed in ${mode} mode`, "tool_not_allowed");
    }
    if (tool.riskLevel === "L3" || tool.riskLevel === "L4") {
      return failure("Permission required", TOOL_PERMISSION_REQUIRED);
    }

    try {
      return await tool.execute(args, runtime);
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "Tool execution failed",
        "tool_error",
      );
    }
  }
}

function failure(output: string, error: string): ToolResult {
  return { success: false, output, error };
}
