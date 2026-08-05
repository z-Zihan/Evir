import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";

export const PATH_BLOCKED = "path_blocked";

function homeDir(): string {
  if (typeof process !== "undefined" && process.env?.HOME) return process.env.HOME;
  if (typeof process !== "undefined" && process.env?.USERPROFILE) return process.env.USERPROFILE;
  return "/";
}

function validatePath(path: string): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/") && !/^[A-Za-z]:\\/.test(path)) return undefined;
  const resolved = path.replace(/\/+$/, "").replace(/\\/g, "/");
  if (resolved.split("/").some((segment) => segment === "..")) return undefined;
  const home = homeDir();
  const blockedPrefixes = [
    `${home}/.ssh`,
    `${home}/.gnupg`,
    "/etc",
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/var",
    "/private/etc",
    `${home}/Library/Keychains`,
  ];
  for (const blocked of blockedPrefixes) {
    if (resolved === blocked || resolved.startsWith(`${blocked}/`)) return undefined;
  }
  return resolved;
}

function pathBlocked(): ToolResult {
  return { success: false, output: "Path not allowed", error: PATH_BLOCKED };
}

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
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    const content = await runtime.storage.readFile(safePath);
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
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    const entries = await runtime.storage.listDir(safePath);
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
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    await runtime.storage.writeFile(safePath, parsed.data.content);
    const bytes = new TextEncoder().encode(parsed.data.content).byteLength;
    return { success: true, output: `wrote ${bytes} bytes to ${safePath}` };
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
