import {
  MODE_TOOL_RISK_LIMITS,
  type InteractionMode,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult,
} from "../providers/tool-registry";
import type { EvirRuntime } from "../../runtime/types";
import { riskLevelExceeds } from "./tool-registry-impl";

export const TOOL_PERMISSION_REQUIRED = "permission_required";
export const TOOL_NOT_AVAILABLE = "not_available_in_browser";
export const TOOL_DENIED = "tool_denied";
export const TOOL_NOT_ALLOWED = "tool_not_allowed";
export const TOOL_CAPABILITY_MISSING = "capability_not_available";

/**
 * Checks a tool against mode risk limits, runtime capabilities, and L3+ approval
 * before it is allowed to run. Returns an error code, or null if the tool may execute.
 */
export function validateToolForExecution(
  tool: ToolDefinition,
  mode: InteractionMode,
  runtime: EvirRuntime,
  approved: boolean,
): string | null {
  if (riskLevelExceeds(tool.riskLevel, MODE_TOOL_RISK_LIMITS[mode])) {
    return TOOL_NOT_ALLOWED;
  }
  if (tool.requiredCapability && !runtime.has(tool.requiredCapability)) {
    return TOOL_CAPABILITY_MISSING;
  }
  if ((tool.riskLevel === "L3" || tool.riskLevel === "L4") && !approved) {
    return TOOL_PERMISSION_REQUIRED;
  }
  return null;
}

function messageFor(errorCode: string, tool: ToolDefinition, mode: InteractionMode): string {
  switch (errorCode) {
    case TOOL_NOT_ALLOWED:
      return `Tool ${tool.name} is not allowed in ${mode} mode`;
    case TOOL_CAPABILITY_MISSING:
      return `Tool ${tool.name} requires the '${tool.requiredCapability}' capability, which is not available in this runtime`;
    case TOOL_PERMISSION_REQUIRED:
      return "Permission required";
    default:
      return "Tool execution not allowed";
  }
}

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    runtime: EvirRuntime,
    approved = false,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const tool =
      this.registry.get(toolName) ?? this.registry.list().find((item) => item.name === toolName);
    if (!tool) return failure(`Unknown tool: ${toolName}`, "tool_not_found");

    const mode = runtime.mode ?? "ask";
    const validationError = validateToolForExecution(tool, mode, runtime, approved);
    if (validationError) {
      return failure(messageFor(validationError, tool, mode), validationError);
    }
    if (signal?.aborted) return failure("Tool execution cancelled", "tool_cancelled");

    const cancelActiveCommands = () => {
      void runtime.storage?.cancelActiveCommands();
    };
    signal?.addEventListener("abort", cancelActiveCommands, { once: true });
    try {
      const result = await tool.execute(args, runtime, signal);
      return signal?.aborted ? failure("Tool execution cancelled", "tool_cancelled") : result;
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "Tool execution failed",
        "tool_error",
      );
    } finally {
      signal?.removeEventListener("abort", cancelActiveCommands);
    }
  }
}

function failure(output: string, error: string): ToolResult {
  return { success: false, output, error };
}
