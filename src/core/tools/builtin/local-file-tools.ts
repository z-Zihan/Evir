import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { redactLogValue } from "../../logging/redaction";
import { logger } from "../../logging/logger";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";

export const PATH_BLOCKED = "path_blocked";

function homeDir(): string {
  if (typeof process !== "undefined" && process.env?.HOME) return process.env.HOME;
  if (typeof process !== "undefined" && process.env?.USERPROFILE) return process.env.USERPROFILE;
  return "/";
}

function validatePath(path: string): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) return undefined;
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

function pathWithinRoot(path: string, root: string): boolean {
  const toComparable = (value: string) =>
    /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
  const pathValue = toComparable(path);
  const rootValue = toComparable(root);
  return pathValue === rootValue || pathValue.startsWith(`${rootValue}/`);
}

export function validateWorkspacePath(path: string, runtime: EvirRuntime): string | undefined {
  const safeRoot = validatePath(runtime.getWorkspaceRoot?.() ?? "");
  if (!safeRoot || !path) return undefined;

  const normalizedInput = path.replace(/\\/g, "/");
  const isAbsolute = normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput);
  let safePath: string | undefined;
  if (isAbsolute) {
    safePath = validatePath(normalizedInput);
  } else {
    if (/^[A-Za-z]:/.test(normalizedInput)) return undefined;
    const segments = normalizedInput.split("/");
    if (segments.some((segment) => segment === "..")) return undefined;
    const relativeSegments = segments.filter((segment) => segment !== "" && segment !== ".");
    const rootSegments = safeRoot.split("/").filter(Boolean);
    const workspaceName = rootSegments.at(-1);
    const isWindowsRoot = /^[A-Za-z]:\//.test(safeRoot);
    if (
      workspaceName &&
      relativeSegments[0] &&
      (isWindowsRoot
        ? relativeSegments[0].toLowerCase() === workspaceName.toLowerCase()
        : relativeSegments[0] === workspaceName)
    ) {
      relativeSegments.shift();
    }
    safePath = validatePath(
      relativeSegments.length > 0 ? `${safeRoot}/${relativeSegments.join("/")}` : safeRoot,
    );
  }
  if (!safePath) return undefined;
  // Full Access lifts the path boundary the user granted explicitly; blocked
  // system prefixes still apply via validatePath above.
  if (runtime.permissionContext?.profile === "full") return safePath;
  const grantedRoots = runtime.permissionContext?.roots ?? [safeRoot];
  return grantedRoots.some((root) => pathWithinRoot(safePath, root)) ? safePath : undefined;
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
  properties: {
    path: {
      type: "string",
      description: "Path inside the selected workspace; relative paths resolve from its root",
    },
  },
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
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Local file operation failed";
  const redactedMessage = redactLogValue(rawMessage);
  return {
    success: false,
    output:
      typeof redactedMessage === "string"
        ? redactedMessage.slice(0, 1_000)
        : "Local file operation failed",
    error: "tool_error",
  };
}

async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rememberFileRead(path: string, content: string, hash: string, runtime: EvirRuntime): void {
  if (!runtime.agentRun) return;
  const reference = {
    path,
    contentHash: hash,
    lastReadAt: Date.now(),
    summary: `Read ${new TextEncoder().encode(content).byteLength} bytes`,
    stale: false,
  };
  runtime.agentRun.fileReferences = [
    ...runtime.agentRun.fileReferences.filter(({ path: existingPath }) => existingPath !== path),
    reference,
  ];
}

function markFileReferenceStale(path: string, runtime: EvirRuntime): void {
  if (!runtime.agentRun) return;
  const existing = runtime.agentRun.fileReferences.find(
    ({ path: existingPath }) => existingPath === path,
  );
  if (existing) existing.stale = true;
}

async function snapshotBeforeMutation(
  path: string,
  runtime: EvirRuntime,
): Promise<ToolResult | undefined> {
  if (runtime.mode !== "agent" || !runtime.storage || !runtime.agentRun) return undefined;
  if (runtime.agentRun.snapshots.some(({ file_path: filePath }) => filePath === path)) {
    return undefined;
  }
  try {
    const snapshot = await runtime.storage.createSnapshot(path, runtime.agentRun.id);
    runtime.agentRun.snapshots.push(snapshot);
    return undefined;
  } catch (error) {
    return {
      success: false,
      output: error instanceof Error ? error.message : "Failed to create safety snapshot",
      error: "snapshot_failed",
    };
  }
}

async function sealMutationSnapshot(
  path: string,
  runtime: EvirRuntime,
): Promise<ToolResult | undefined> {
  if (runtime.mode !== "agent" || !runtime.storage || !runtime.agentRun) return undefined;
  const snapshot = runtime.agentRun.snapshots.find(({ file_path: filePath }) => filePath === path);
  if (!snapshot) return undefined;
  try {
    await runtime.storage.sealSnapshot(snapshot.snapshot_id, runtime.agentRun.id, path);
    return undefined;
  } catch (error) {
    return {
      success: false,
      output: error instanceof Error ? error.message : "Failed to seal safety snapshot",
      error: "snapshot_seal_failed",
    };
  }
}

async function readFile(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = pathArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  if (!safePath) return pathBlocked();
  try {
    const content = await runtime.storage.readFile(safePath);
    const hash = await contentHash(content);
    rememberFileRead(safePath, content, hash, runtime);
    const output = content.length > 10_000 ? `${content.slice(0, 10_000)}\n... truncated` : content;
    return { success: true, output: `${output}\n\n[evir:file sha256=${hash}]` };
  } catch (error) {
    return toolError(error);
  }
}

async function listDirectory(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  const dbg = (step: string, extra?: string) =>
    logger.debug("tool", `listdir.${step}`, {
      step,
      args,
      profile: runtime.permissionContext?.profile ?? null,
      ...(extra === undefined ? {} : { extra: extra.slice(0, 200) }),
    });
  dbg("enter");
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = pathArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  dbg("validated", safePath);
  if (!safePath) return pathBlocked();
  try {
    dbg("invoke");
    const entries = await runtime.storage.listDir(safePath);
    dbg("done", String(entries.length));
    const names = entries.slice(0, 200).map((entry) => `${entry.name}${entry.is_dir ? "/" : ""}`);
    if (entries.length > 200) names.push("... truncated");
    return { success: true, output: names.join("\n") };
  } catch (error) {
    dbg("error", error instanceof Error ? error.message : "list failed");
    return toolError(error);
  }
}

async function writeFile(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = writeArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  if (!safePath) return pathBlocked();
  try {
    const snapshotError = await snapshotBeforeMutation(safePath, runtime);
    if (snapshotError) return snapshotError;
    await runtime.storage.writeFile(safePath, parsed.data.content);
    const sealError = await sealMutationSnapshot(safePath, runtime);
    if (sealError) return sealError;
    markFileReferenceStale(safePath, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  if (!safePath) return pathBlocked();
  try {
    const snapshotError = await snapshotBeforeMutation(safePath, runtime);
    if (snapshotError) return snapshotError;
    await runtime.storage.applyPatch(safePath, parsed.data.old_content, parsed.data.new_content);
    const sealError = await sealMutationSnapshot(safePath, runtime);
    if (sealError) return sealError;
    markFileReferenceStale(safePath, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  if (!safePath) return pathBlocked();
  try {
    const results = await runtime.storage.searchFiles(safePath, parsed.data.pattern);
    return { success: true, output: results.join("\n") || "no matches" };
  } catch (error) {
    return toolError(error);
  }
}

const DOC_EXTENSIONS = [".md", ".mdx", ".txt", ".rst", ".adoc"];

/** Project knowledge v1: deterministic full-text search over project docs
 * (markdown/ADR/README) — no vector DB, per docs/advanced-agent-capabilities-plan.md. */
async function searchDocs(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = searchArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  if (!safePath) return pathBlocked();
  try {
    const candidates = await runtime.storage.searchFiles(safePath, "");
    const docs = candidates.filter((file) =>
      DOC_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension)),
    );
    const needle = parsed.data.pattern.toLowerCase();
    const hits: string[] = [];
    for (const doc of docs.slice(0, 200)) {
      const content = await runtime.storage.readFile(doc).catch(() => "");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(needle) && hits.length < 80) {
          hits.push(`${doc}:${index + 1}: ${line.trim().slice(0, 160)}`);
        }
      });
    }
    return { success: true, output: hits.join("\n") || "no matches in project docs" };
  } catch (error) {
    return toolToolError(error);
  }
}

function toolToolError(error: unknown): ToolResult {
  return {
    success: false,
    output: error instanceof Error ? error.message : "search_docs failed",
    error: "tool_error",
  };
}

async function runCommand(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = commandArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safeCwd = validateWorkspacePath(parsed.data.cwd, runtime);
  if (!safeCwd) return pathBlocked();
  try {
    const result = await runtime.storage.runCommand(
      safeCwd,
      parsed.data.program,
      parsed.data.args,
      parsed.data.timeout_ms,
    );
    const output = `exit_code: ${result.exit_code ?? "N/A"}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
    return {
      success: result.success,
      output,
      // The command ran and reported a programmatic outcome; keep the honest
      // exit code so consumers can tell "command failed" from "tool failed".
      ...(result.exit_code !== null && result.exit_code !== undefined
        ? { exitCode: result.exit_code }
        : {}),
    };
  } catch (error) {
    return toolError(error);
  }
}

async function gitStatus(args: Record<string, unknown>, runtime: EvirRuntime): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = gitArgsSchema.safeParse(args);
  if (!parsed.success) return toolError(new Error(parsed.error.issues[0]?.message));
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.file_path, runtime);
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
  const safePath = validateWorkspacePath(parsed.data.file_path, runtime);
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
    description: "Read text from a path inside the selected workspace.",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "filesystem",
    schema: pathJsonSchema,
    execute: readFile,
  },
  {
    id: "list_directory",
    name: "list_directory",
    description: "List files and directories at a path inside the selected workspace.",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "filesystem",
    schema: pathJsonSchema,
    execute: listDirectory,
  },
  {
    id: "write_file",
    name: "write_file",
    description: "Write text content to a path inside the selected workspace.",
    source: "evir-local",
    riskLevel: "L3",
    requiredCapability: "filesystem",
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
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path inside the selected workspace; relative paths are supported",
        },
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
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path inside the selected workspace" },
        pattern: { type: "string", description: "File name pattern (case-insensitive substring)" },
      },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
    execute: searchFiles,
  },
  {
    id: "search_docs",
    name: "search_docs",
    description:
      "Full-text search across project documentation (markdown/ADR/README/txt) with file:line results. Use for design history, PRD, and architecture questions before reading source.",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path inside the selected workspace" },
        pattern: { type: "string", description: "Case-insensitive text to find" },
      },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
    execute: searchDocs,
  },
  {
    id: "run_command",
    name: "run_command",
    description:
      "Execute a program with arguments in the workspace directory. Uses argument array (no shell interpolation).",
    source: "evir-local",
    riskLevel: "L3",
    requiredCapability: "terminal",
    schema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Working directory inside the selected workspace" },
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
    requiredCapability: "git",
    schema: pathJsonSchema,
    execute: gitStatus,
  },
  {
    id: "git_diff",
    name: "git_diff",
    description: "Get git diff for a directory. Returns unified diff text.",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "git",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path inside the selected workspace" },
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
    requiredCapability: "filesystem",
    schema: pathJsonSchema,
    execute: createDirectory,
  },
  {
    id: "file_stat",
    name: "file_stat",
    description: "Get file metadata (size, modified time, type, symlink status).",
    source: "evir-local",
    riskLevel: "L1",
    requiredCapability: "filesystem",
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
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "File path inside the selected workspace" },
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
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        snapshot_id: { type: "string" },
        run_id: { type: "string" },
        file_path: { type: "string", description: "File path inside the selected workspace" },
      },
      required: ["snapshot_id", "run_id", "file_path"],
      additionalProperties: false,
    },
    execute: restoreSnapshot,
  },
];
