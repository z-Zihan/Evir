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
const patchArgsSchema = pathArgsSchema
  .extend({ old_content: z.string(), new_content: z.string() })
  .strict();
const searchArgsSchema = z.object({ path: z.string().min(1), pattern: z.string().min(1) }).strict();
const commandArgsSchema = z
  .object({
    cwd: z.string().min(1),
    program: z.string().min(1),
    args: z.array(z.string()).default([]),
    timeout_ms: z.number().optional(),
  })
  .strict();
const gitArgsSchema = z.object({ path: z.string().min(1) }).strict();
const gitDiffArgsSchema = z
  .object({ path: z.string().min(1), staged: z.boolean().default(false) })
  .strict();

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

async function applyPatch(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = patchArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    await runtime.storage.applyPatch(safePath, parsed.data.old_content, parsed.data.new_content);
    return { success: true, output: `patched ${safePath}` };
  } catch (error) {
    return toolError(error);
  }
}

async function searchFiles(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = searchArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    const results = await runtime.storage.searchFiles(safePath, parsed.data.pattern);
    return { success: true, output: results.join("\n") || "no matches" };
  } catch (error) {
    return toolError(error);
  }
}

async function runCommand(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = commandArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safeCwd = validatePath(parsed.data.cwd);
  if (!safeCwd) return pathBlocked();
  try {
    const result = await runtime.storage.runCommand(
      safeCwd,
      parsed.data.program,
      parsed.data.args,
      parsed.data.timeout_ms,
    );
    const output = `exit_code: ${result.exit_code ?? "N/A"}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
    return { success: result.success, output };
  } catch (error) {
    return toolError(error);
  }
}

async function gitStatus(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = gitArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    const result = await runtime.storage.gitStatus(safePath);
    if (!result.is_repo) return { success: true, output: "Not a git repository" };
    const lines = result.entries.map((e) => `${e.status}\t${e.file}`);
    return { success: true, output: `branch: ${result.branch ?? "unknown"}\n${lines.join("\n")}` };
  } catch (error) {
    return toolError(error);
  }
}

async function gitDiff(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = gitDiffArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    const diff = await runtime.storage.gitDiff(safePath, parsed.data.staged);
    return { success: true, output: diff || "no changes" };
  } catch (error) {
    return toolError(error);
  }
}

async function createDirectory(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = pathArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    await runtime.storage.createDirectory(safePath);
    return { success: true, output: `created directory: ${safePath}` };
  } catch (error) {
    return toolError(error);
  }
}

async function fileStat(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = pathArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.path);
  if (!safePath) return pathBlocked();
  try {
    const stat = await runtime.storage.fileStat(safePath);
    return { success: true, output: JSON.stringify(stat, null, 2) };
  } catch (error) {
    return toolError(error);
  }
}

const snapshotArgsSchema = z
  .object({ file_path: z.string().min(1), run_id: z.string().min(1) })
  .strict();
const restoreArgsSchema = z
  .object({
    snapshot_id: z.string().min(1),
    run_id: z.string().min(1),
    file_path: z.string().min(1),
  })
  .strict();

async function createSnapshot(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = snapshotArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.file_path);
  if (!safePath) return pathBlocked();
  try {
    const result = await runtime.storage.createSnapshot(safePath, parsed.data.run_id);
    return { success: true, output: `snapshot created: ${result.snapshot_id}` };
  } catch (error) {
    return toolError(error);
  }
}

async function restoreSnapshot(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = restoreArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validatePath(parsed.data.file_path);
  if (!safePath) return pathBlocked();
  try {
    const ok = await runtime.storage.restoreSnapshot(
      parsed.data.snapshot_id,
      parsed.data.run_id,
      safePath,
    );
    return { success: ok, output: ok ? "file restored from snapshot" : "restore failed" };
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
  {
    id: "apply_patch",
    name: "apply_patch",
    description:
      "Apply a search-and-replace patch to a file. Replaces first occurrence of old_content with new_content.",
    source: "evir-local",
    riskLevel: "L3",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute filesystem path" },
        old_content: { type: "string", description: "Exact text to find in the file" },
        new_content: { type: "string", description: "Text to replace it with" },
      },
      required: ["path", "old_content", "new_content"],
      additionalProperties: false,
    },
    execute: applyPatch,
  },
  {
    id: "search_files",
    name: "search_files",
    description: "Search for files by name pattern in a directory tree (max depth 5).",
    source: "evir-local",
    riskLevel: "L1",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute directory path to search in" },
        pattern: { type: "string", description: "File name pattern (case-insensitive substring)" },
      },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
    execute: searchFiles,
  },
  {
    id: "run_command",
    name: "run_command",
    description:
      "Execute a program with arguments in the workspace directory. Uses argument array (no shell interpolation).",
    source: "evir-local",
    riskLevel: "L3",
    schema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Working directory (absolute path)" },
        program: { type: "string", description: "Program to execute (e.g. 'npm', 'git', 'cargo')" },
        args: { type: "array", items: { type: "string" }, description: "Arguments array" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (default 30000)" },
      },
      required: ["cwd", "program", "args"],
      additionalProperties: false,
    },
    execute: runCommand,
  },
  {
    id: "git_status",
    name: "git_status",
    description: "Get git status for a directory. Returns branch and modified files.",
    source: "evir-local",
    riskLevel: "L1",
    schema: pathJsonSchema,
    execute: gitStatus,
  },
  {
    id: "git_diff",
    name: "git_diff",
    description: "Get git diff for a directory. Returns unified diff text.",
    source: "evir-local",
    riskLevel: "L1",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute directory path" },
        staged: { type: "boolean", description: "Show staged changes (default false)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    execute: gitDiff,
  },
  {
    id: "create_directory",
    name: "create_directory",
    description: "Create a directory and all parent directories.",
    source: "evir-local",
    riskLevel: "L2",
    schema: pathJsonSchema,
    execute: createDirectory,
  },
  {
    id: "file_stat",
    name: "file_stat",
    description: "Get file metadata (size, modified time, type, symlink status).",
    source: "evir-local",
    riskLevel: "L1",
    schema: pathJsonSchema,
    execute: fileStat,
  },
  {
    id: "create_snapshot",
    name: "create_snapshot",
    description:
      "Create a snapshot of a file before modification. Returns snapshot_id for later restore.",
    source: "evir-local",
    riskLevel: "L1",
    schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute file path" },
        run_id: { type: "string", description: "Agent run ID" },
      },
      required: ["file_path", "run_id"],
      additionalProperties: false,
    },
    execute: createSnapshot,
  },
  {
    id: "restore_snapshot",
    name: "restore_snapshot",
    description: "Restore a file from a previously created snapshot.",
    source: "evir-local",
    riskLevel: "L3",
    schema: {
      type: "object",
      properties: {
        snapshot_id: { type: "string" },
        run_id: { type: "string" },
        file_path: { type: "string", description: "Absolute file path" },
      },
      required: ["snapshot_id", "run_id", "file_path"],
      additionalProperties: false,
    },
    execute: restoreSnapshot,
  },
];
