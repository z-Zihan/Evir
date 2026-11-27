import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";
import { redactLogValue } from "../../logging/redaction";
import { logger } from "../../logging/logger";

/**
 * Desktop computer-use (CUA) tools — opt-in (`evir.tools.computer-use` is
 * disabled by default) and macOS-only in v1.
 *
 * Permission tiers (validated by ToolExecutor against the run profile):
 * - L1 read-only: screenshot (saved to app data, returns path + dimensions)
 *   and frontmost-app lookup.
 * - L3 desktop control: click / type / key. Synthetic input drives the real
 *   pointer and keyboard outside any sandbox, so it always needs the approval
 *   conversation — unlike browser_click, which stays inside the agent browser.
 *
 * Screen content is untrusted external input: it never grants permissions and
 * is never echoed back beyond the saved path.
 */

const MAX_TOOL_OUTPUT_CHARS = 4_000;

const SCREEN_BOUNDS = { min: 0, max: 20_000 } as const;

function unavailable(): ToolResult {
  return {
    success: false,
    output: "This tool requires the Evir desktop computer-use runtime (opt-in, macOS).",
    error: TOOL_NOT_AVAILABLE,
  };
}

function toolError(error: unknown): ToolResult {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Computer operation failed";
  const redacted = redactLogValue(rawMessage);
  logger.warn("computer-use", "computer.tool-failed", {
    message: typeof redacted === "string" ? redacted.slice(0, 300) : "redacted",
  });
  return {
    success: false,
    output: typeof redacted === "string" ? redacted.slice(0, 500) : "Computer operation failed",
    error: "computer_error",
  };
}

function compact(value: unknown): string {
  const text = JSON.stringify(value, null, 0) ?? "";
  return text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…` : text;
}

async function runComputerCommand(
  command: string,
  args: Record<string, unknown>,
  runtime: EvirRuntime,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.has("computerUse")) return unavailable();
  if (signal?.aborted) return { success: false, output: "Aborted", error: "aborted" };
  try {
    const { invokeComputerCommand } =
      await import("../../../features/computer-use/computer-provider");
    const result = await invokeComputerCommand<unknown>(command, args);
    return { success: true, output: compact(result) };
  } catch (error) {
    return toolError(error);
  }
}

const emptyArgs = z.object({}).strict();
const clickArgs = z
  .object({
    x: z.number().int().min(SCREEN_BOUNDS.min).max(SCREEN_BOUNDS.max),
    y: z.number().int().min(SCREEN_BOUNDS.min).max(SCREEN_BOUNDS.max),
  })
  .strict();
const typeArgs = z.object({ text: z.string().min(1).max(2_000) }).strict();
const keyArgs = z
  .object({
    key: z.string().min(1).max(32),
    modifiers: z
      .array(z.enum(["command", "option", "control", "shift"]))
      .max(4)
      .optional(),
  })
  .strict();

function parseArgs<T extends z.ZodType>(schema: T, args: Record<string, unknown>) {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      output: `Invalid arguments: ${parsed.error.issues[0]?.message ?? "schema"}`,
      error: "invalid_args",
    } satisfies ToolResult;
  }
  return parsed.data;
}

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === "object" && value !== null && "success" in value && "output" in value;
}

async function executeWith(
  schema: z.ZodType,
  args: Record<string, unknown>,
  command: string,
  runtime: EvirRuntime,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const parsed = parseArgs(schema, args);
  if (isToolResult(parsed)) return parsed;
  return runComputerCommand(command, parsed as Record<string, unknown>, runtime, signal);
}

export const COMPUTER_TOOLS: readonly ToolDefinition[] = [
  {
    id: "computer_screenshot",
    name: "computer_screenshot",
    description:
      "Capture the whole screen as a PNG (saved under Evir app data) and return its path and dimensions. Use it to see desktop state the browser tools cannot reach; pair with computer_frontmost_app to know what you are looking at.",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "computerUse",
    schema: { type: "object", properties: {}, additionalProperties: false },
    execute: (args, runtime, signal) =>
      executeWith(emptyArgs, args, "computer_screenshot", runtime, signal),
  },
  {
    id: "computer_frontmost_app",
    name: "computer_frontmost_app",
    description:
      "Return the name of the frontmost macOS application. Read-only; use before click/type so input goes to the intended app.",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "computerUse",
    schema: { type: "object", properties: {}, additionalProperties: false },
    execute: (args, runtime, signal) =>
      executeWith(emptyArgs, args, "computer_frontmost_app", runtime, signal),
  },
  {
    id: "computer_click",
    name: "computer_click",
    description:
      "Left-click at absolute screen coordinates. Moves the real pointer outside any sandbox — take a screenshot first and confirm the target.",
    source: "evir-local",
    riskLevel: "L3",
    requiredCapability: "computerUse",
    schema: {
      type: "object",
      properties: {
        x: { type: "integer", minimum: SCREEN_BOUNDS.min, maximum: SCREEN_BOUNDS.max },
        y: { type: "integer", minimum: SCREEN_BOUNDS.min, maximum: SCREEN_BOUNDS.max },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    execute: (args, runtime, signal) =>
      executeWith(clickArgs, args, "computer_click", runtime, signal),
  },
  {
    id: "computer_type",
    name: "computer_type",
    description:
      "Type text into whatever currently has focus. Goes through the real keyboard — the frontmost app receives it, so verify focus first.",
    source: "evir-local",
    riskLevel: "L3",
    requiredCapability: "computerUse",
    schema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: (args, runtime, signal) =>
      executeWith(typeArgs, args, "computer_type", runtime, signal),
  },
  {
    id: "computer_key",
    name: "computer_key",
    description:
      "Press a key (return, tab, escape, delete, space, arrows, home/end, page up/down, f1-f12) with optional command/option/control/shift modifiers.",
    source: "evir-local",
    riskLevel: "L3",
    requiredCapability: "computerUse",
    schema: {
      type: "object",
      properties: {
        key: { type: "string", minLength: 1, maxLength: 32 },
        modifiers: {
          type: "array",
          items: { type: "string", enum: ["command", "option", "control", "shift"] },
          maxItems: 4,
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
    execute: (args, runtime, signal) => executeWith(keyArgs, args, "computer_key", runtime, signal),
  },
];
