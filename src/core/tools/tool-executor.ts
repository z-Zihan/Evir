import {
  MODE_TOOL_RISK_LIMITS,
  type InteractionMode,
  type ToolCallContext,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult,
} from "../providers/tool-registry";
import type { EvirRuntime } from "../../runtime/types";
import { riskLevelExceeds } from "./tool-registry-impl";
import { candidatePathFromArgs, resolveExecutionPermission } from "../security/permission-profiles";
import { logger } from "../logging/logger";

export const TOOL_PERMISSION_REQUIRED = "permission_required";
export const TOOL_NOT_AVAILABLE = "not_available_in_browser";
export const TOOL_DENIED = "tool_denied";
export const TOOL_NOT_ALLOWED = "tool_not_allowed";
export const TOOL_CAPABILITY_MISSING = "capability_not_available";

/**
 * Checks a tool against mode risk limits, runtime capabilities, L2+ approval,
 * and the run's permission profile before it is allowed to run. Mode limits
 * run first and cannot be upgraded by any permission profile. L2+ matches the
 * documented permission policy (permission-profiles.ts): every mutating tool
 * resolves against the profile, not only L3/L4. Returns an error code, or
 * null if the tool may execute.
 */
export function validateToolForExecution(
  tool: ToolDefinition,
  mode: InteractionMode,
  runtime: EvirRuntime,
  approved: boolean,
  args: Record<string, unknown> = {},
): string | null {
  if (riskLevelExceeds(tool.riskLevel, MODE_TOOL_RISK_LIMITS[mode])) {
    return TOOL_NOT_ALLOWED;
  }
  if (tool.requiredCapability && !runtime.has(tool.requiredCapability)) {
    return TOOL_CAPABILITY_MISSING;
  }
  if (riskLevelExceeds(tool.riskLevel, "L1") && !approved) {
    const decision = resolveExecutionPermission(
      runtime.permissionContext,
      tool.riskLevel,
      candidatePathFromArgs(args),
    );
    if (decision.autoApproved) {
      logger.info("security", "permission.auto-approved", {
        toolName: tool.name,
        profile: runtime.permissionContext?.profile ?? null,
        reason: decision.reason,
      });
      return null;
    }
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
    call?: ToolCallContext,
  ): Promise<ToolResult> {
    const tool =
      this.registry.get(toolName) ?? this.registry.list().find((item) => item.name === toolName);
    if (!tool) return failure(`Unknown tool: ${toolName}`, "tool_not_found");

    const mode = runtime.mode ?? "ask";
    logger.debug("tool", "executor.execute", {
      toolName,
      mode,
      approved,
      profile: runtime.permissionContext?.profile ?? null,
    });
    const validationError = validateToolForExecution(tool, mode, runtime, approved, args);
    if (validationError) {
      return failure(messageFor(validationError, tool, mode), validationError);
    }
    if (signal?.aborted) return failure("Tool execution cancelled", "tool_cancelled");

    const cancelActiveCommands = () => {
      void runtime.storage?.cancelActiveCommands();
    };
    signal?.addEventListener("abort", cancelActiveCommands, { once: true });
    try {
      logger.debug("tool", "executor.tool-invoking", { toolName });
      const result = await tool.execute(args, runtime, signal, call);
      logger.debug("tool", "executor.tool-invoked", { toolName, success: result?.success });
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
