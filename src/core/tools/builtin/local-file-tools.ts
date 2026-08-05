import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";

const pathArgsSchema = z.object({ path: z.string().min(1) }).strict();
const writeArgsSchema = pathArgsSchema.extend({ content: z.string() }).strict();
const pathJsonSchema = {
  type: "object",
  properties: { path: { type: "string", description: "Absolute filesystem path" } },
  required: ["path"],
  additionalProperties: false,
};

function unavailable(): ToolResult {
  return {
    success: false,
    output: "This tool is not available in browser mode.",
    error: TOOL_NOT_AVAILABLE,
  };
}

function toolError(error: unknown): ToolResult {
  return {
    success: false,
    output: error instanceof Error ? error.message : "Local file operation failed",
    error: "tool_error",
  };
}

async function readFile(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = pathArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  try {
    const content = await runtime.storage.readFile(parsed.data.path);
    const output = content.length > 10_000 ? `${content.slice(0, 10_000)}\n... truncated` : content;
    return { success: true, output };
  } catch (error) {
    return toolError(error);
  }
}

async function listDirectory(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = pathArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  try {
    const entries = await runtime.storage.listDir(parsed.data.path);
    const names = entries.slice(0, 200).map((entry) => `${entry.name}${entry.is_dir ? "/" : ""}`);
    if (entries.length > 200) names.push("... truncated");
    return { success: true, output: names.join("\n") };
  } catch (error) {
    return toolError(error);
  }
}

async function writeFile(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = writeArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  try {
    await runtime.storage.writeFile(parsed.data.path, parsed.data.content);
    const bytes = new TextEncoder().encode(parsed.data.content).byteLength;
    return { success: true, output: `wrote ${bytes} bytes to ${parsed.data.path}` };
  } catch (error) {
    return toolError(error);
  }
}

export const LOCAL_FILE_TOOLS: readonly ToolDefinition[] = [
  {
    id: "read_file",
    name: "read_file",
    description: "Read text from an absolute local filesystem path.",
    source: "evir-local",
    riskLevel: "L1",
    schema: pathJsonSchema,
    execute: readFile,
  },
  {
    id: "list_directory",
    name: "list_directory",
    description: "List files and directories at an absolute local filesystem path.",
    source: "evir-local",
    riskLevel: "L1",
    schema: pathJsonSchema,
    execute: listDirectory,
  },
  {
    id: "write_file",
    name: "write_file",
    description: "Write text content to an absolute local filesystem path.",
    source: "evir-local",
    riskLevel: "L3",
    schema: {
      ...pathJsonSchema,
      properties: {
        ...pathJsonSchema.properties,
        content: { type: "string", description: "Complete text content to write" },
      },
      required: ["path", "content"],
    },
    execute: writeFile,
  },
];
