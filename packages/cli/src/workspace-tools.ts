import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveExistingWorkspacePath, resolveWritableWorkspacePath } from "./workspace-boundary";

const MAX_BYTES = 256 * 1024;

export interface CliTool {
  name: string;
  description: string;
  risk: "read" | "write" | "execute";
  parameters: Record<string, unknown>;
  preview(args: unknown): string;
  execute(args: unknown, signal: AbortSignal): Promise<string>;
}

export function createWorkspaceTools(root: string): CliTool[] {
  return [
    readFileTool(root),
    listDirectoryTool(root),
    searchFilesTool(root),
    writeFileTool(root),
    runCommandTool(root),
    gitTool(root, "git_status", ["status", "--short"]),
    gitTool(root, "git_diff", ["diff", "--no-ext-diff"]),
  ];
}

function readFileTool(root: string): CliTool {
  const schema = z.object({ path: z.string().min(1).max(4096) });
  return tool(
    "read_file",
    "Read a UTF-8 workspace file.",
    "read",
    {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    schema,
    (args) => `Read ${args.path}`,
    async (args) => {
      const target = await resolveExistingWorkspacePath(root, args.path);
      const content = await readFile(target);
      if (content.byteLength > MAX_BYTES) throw new Error(`File exceeds ${MAX_BYTES} bytes`);
      return content.toString("utf8");
    },
  );
}

function listDirectoryTool(root: string): CliTool {
  const schema = z.object({ path: z.string().min(1).max(4096).default(".") });
  return tool(
    "list_directory",
    "List workspace directory entries.",
    "read",
    { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    schema,
    (args) => `List ${args.path}`,
    async (args) => {
      const target = await resolveExistingWorkspacePath(root, args.path);
      const entries = await readdir(target, { withFileTypes: true });
      return entries
        .slice(0, 200)
        .map((entry) => `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`)
        .join("\n");
    },
  );
}

function searchFilesTool(root: string): CliTool {
  const schema = z.object({ pattern: z.string().min(1).max(500) });
  return tool(
    "search_files",
    "Find workspace files whose relative path contains a term.",
    "read",
    {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
    schema,
    (args) => `Search files for ${args.pattern}`,
    async (args) => {
      const matches: string[] = [];
      await walk(root, root, args.pattern.toLowerCase(), matches);
      return matches.join("\n");
    },
  );
}

function writeFileTool(root: string): CliTool {
  const schema = z.object({
    path: z.string().min(1).max(4096),
    content: z.string().max(1_000_000),
  });
  return tool(
    "write_file",
    "Create or replace a UTF-8 workspace file.",
    "write",
    {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    schema,
    (args) => `Replace ${args.path} (${args.content.length} characters)`,
    async (args) => {
      const target = await resolveWritableWorkspacePath(root, args.path);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.evir-${process.pid}.tmp`;
      await writeFile(temporary, args.content, "utf8");
      await rename(temporary, target);
      return `Wrote ${Buffer.byteLength(args.content)} bytes to ${path.relative(root, target)}`;
    },
  );
}

function runCommandTool(root: string): CliTool {
  const schema = z.object({
    program: z.string().min(1).max(500),
    args: z.array(z.string().max(4096)).max(100).default([]),
    timeoutMs: z.number().int().min(1000).max(120_000).default(120_000),
  });
  return tool(
    "run_command",
    "Run a program and argument array without shell interpolation.",
    "execute",
    {
      type: "object",
      properties: {
        program: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "integer" },
      },
      required: ["program", "args"],
      additionalProperties: false,
    },
    schema,
    (args) => `Run: ${[args.program, ...args.args].join(" ")}`,
    (args, signal) => runProcess(args.program, args.args, root, args.timeoutMs, signal),
  );
}

function gitTool(root: string, name: string, args: string[]): CliTool {
  const schema = z.object({});
  return tool(
    name,
    name === "git_status" ? "Show Git status." : "Show unstaged Git diff.",
    "read",
    { type: "object", properties: {}, additionalProperties: false },
    schema,
    () => name,
    (_args, signal) => runProcess("git", args, root, 30_000, signal),
  );
}

function tool<T>(
  name: string,
  description: string,
  risk: CliTool["risk"],
  parameters: Record<string, unknown>,
  schema: z.ZodType<T>,
  preview: (args: T) => string,
  execute: (args: T, signal: AbortSignal) => Promise<string>,
): CliTool {
  return {
    name,
    description,
    risk,
    parameters,
    preview: (raw) => preview(schema.parse(raw)),
    execute: (raw, signal) => execute(schema.parse(raw), signal),
  };
}

async function walk(
  root: string,
  directory: string,
  term: string,
  matches: string[],
): Promise<void> {
  if (matches.length >= 200) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "target"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const relative = path.relative(root, target);
    if (relative.toLowerCase().includes(term)) matches.push(relative);
    if (entry.isDirectory()) await walk(root, target, term, matches);
    if (matches.length >= 200) return;
  }
}

function runProcess(
  program: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, shell: false, windowsHide: true });
    let output = "";
    const append = (chunk: Buffer) => {
      const remaining = MAX_BYTES - Buffer.byteLength(output);
      if (remaining > 0) output += chunk.subarray(0, remaining).toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const stop = () => child.kill("SIGTERM");
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(new Error("Command stopped"));
      else if (code === 0) resolve(output || "Command completed with no output.");
      else reject(new Error(`Command exited with code ${code ?? "unknown"}\n${output}`));
    });
  });
}
