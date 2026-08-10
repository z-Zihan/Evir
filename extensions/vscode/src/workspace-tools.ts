import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { z } from "zod";
import { ChangeTracker } from "./change-tracker";
import { pathIsInside } from "./workspace-boundary";

const MAX_READ_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;

export type ToolRisk = "read" | "write" | "execute";
export interface ExtensionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  execute(args: unknown, signal: AbortSignal): Promise<string>;
}

const locationFields = {
  workspaceFolder: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).max(4096),
};
const locationProperties = {
  workspaceFolder: {
    type: "string",
    description: "Workspace folder name. Required when multiple folders are open.",
  },
  path: { type: "string", description: "Path relative to the workspace folder." },
};

export class WorkspaceTools {
  constructor(private readonly changes: ChangeTracker) {}

  list(): ExtensionTool[] {
    return [
      this.readFileTool(),
      this.listDirectoryTool(),
      this.searchFilesTool(),
      this.writeFileTool(),
      this.runCommandTool(),
      this.gitTool("git_status", "Show the workspace Git status.", ["status", "--short"]),
      this.gitTool("git_diff", "Show unstaged workspace changes.", ["diff", "--no-ext-diff"]),
    ];
  }

  private readFileTool(): ExtensionTool {
    const schema = z.object({
      ...locationFields,
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
    });
    return {
      name: "read_file",
      description: "Read a UTF-8 text file inside the selected workspace.",
      risk: "read",
      parameters: {
        type: "object",
        properties: {
          ...locationProperties,
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = schema.parse(raw);
        const target = await this.resolve(args.path, args.workspaceFolder, true);
        const bytes = await vscode.workspace.fs.readFile(target);
        if (bytes.byteLength > MAX_READ_BYTES) {
          throw new Error(`File exceeds the ${MAX_READ_BYTES} byte read limit`);
        }
        const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
        const start = Math.max(0, (args.startLine ?? 1) - 1);
        const end = Math.min(lines.length, args.endLine ?? lines.length);
        return lines
          .slice(start, end)
          .map((line, index) => `${start + index + 1}: ${line}`)
          .join("\n");
      },
    };
  }

  private listDirectoryTool(): ExtensionTool {
    const schema = z.object(locationFields);
    return {
      name: "list_directory",
      description: "List up to 200 entries in a workspace directory.",
      risk: "read",
      parameters: {
        type: "object",
        properties: locationProperties,
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = schema.parse(raw);
        const target = await this.resolve(args.path, args.workspaceFolder, true);
        const entries = await vscode.workspace.fs.readDirectory(target);
        return entries
          .slice(0, 200)
          .map(([name, type]) => `${type === vscode.FileType.Directory ? "dir" : "file"}\t${name}`)
          .join("\n");
      },
    };
  }

  private searchFilesTool(): ExtensionTool {
    const schema = z.object({
      workspaceFolder: z.string().trim().min(1).optional(),
      pattern: z.string().trim().min(1).max(500),
    });
    return {
      name: "search_files",
      description: "Find workspace files with a glob pattern, excluding common dependency folders.",
      risk: "read",
      parameters: {
        type: "object",
        properties: {
          workspaceFolder: locationProperties.workspaceFolder,
          pattern: { type: "string", description: "Glob such as src/**/*.ts" },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = schema.parse(raw);
        const root = this.root(args.workspaceFolder);
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(root, args.pattern),
          "**/{node_modules,.git,dist,target}/**",
          200,
        );
        return files.map((file) => path.relative(root.uri.fsPath, file.fsPath)).join("\n");
      },
    };
  }

  private writeFileTool(): ExtensionTool {
    const schema = z.object({ ...locationFields, content: z.string().max(1_000_000) });
    return {
      name: "write_file",
      description: "Create or replace a UTF-8 file inside the workspace. Requires approval.",
      risk: "write",
      parameters: {
        type: "object",
        properties: {
          ...locationProperties,
          content: { type: "string", description: "Complete new file content." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = schema.parse(raw);
        const target = await this.resolve(args.path, args.workspaceFolder, false);
        let before: Uint8Array<ArrayBufferLike> = new Uint8Array();
        let existed = true;
        try {
          before = await vscode.workspace.fs.readFile(target);
        } catch {
          existed = false;
        }
        const after = new TextEncoder().encode(args.content);
        await this.changes.record(target, before, existed, after);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
        await vscode.workspace.fs.writeFile(target, after);
        return `Wrote ${after.byteLength} bytes to ${vscode.workspace.asRelativePath(target)}. A diff and rollback snapshot are available.`;
      },
    };
  }

  private runCommandTool(): ExtensionTool {
    const schema = z.object({
      workspaceFolder: z.string().trim().min(1).optional(),
      program: z.string().trim().min(1).max(500),
      args: z.array(z.string().max(4096)).max(100).default([]),
      timeoutMs: z.number().int().min(1000).max(120_000).default(120_000),
    });
    return {
      name: "run_command",
      description:
        "Run a program with an argument array in the workspace. Shell interpolation is disabled. Requires approval.",
      risk: "execute",
      parameters: {
        type: "object",
        properties: {
          workspaceFolder: locationProperties.workspaceFolder,
          program: { type: "string" },
          args: { type: "array", items: { type: "string" }, maxItems: 100 },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
        },
        required: ["program", "args"],
        additionalProperties: false,
      },
      execute: async (raw, signal) => {
        const args = schema.parse(raw);
        return runProcess(
          args.program,
          args.args,
          this.root(args.workspaceFolder).uri.fsPath,
          args.timeoutMs,
          signal,
        );
      },
    };
  }

  private gitTool(name: string, description: string, gitArgs: string[]): ExtensionTool {
    const schema = z.object({ workspaceFolder: z.string().trim().min(1).optional() });
    return {
      name,
      description,
      risk: "read",
      parameters: {
        type: "object",
        properties: { workspaceFolder: locationProperties.workspaceFolder },
        additionalProperties: false,
      },
      execute: async (raw, signal) => {
        const args = schema.parse(raw);
        return runProcess(
          "git",
          gitArgs,
          this.root(args.workspaceFolder).uri.fsPath,
          30_000,
          signal,
        );
      },
    };
  }

  private root(name?: string): vscode.WorkspaceFolder {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) throw new Error("No workspace folder is open");
    if (name) {
      const match = folders.find((folder) => folder.name === name);
      if (!match) throw new Error(`Unknown workspace folder: ${name}`);
      if (match.uri.scheme !== "file")
        throw new Error("Agent tools currently require a local file workspace");
      return match;
    }
    if (folders.length > 1)
      throw new Error("workspaceFolder is required for a multi-root workspace");
    const root = folders[0];
    if (!root) throw new Error("No workspace folder is open");
    if (root.uri.scheme !== "file")
      throw new Error("Agent tools currently require a local file workspace");
    return root;
  }

  private async resolve(relativePath: string, rootName: string | undefined, mustExist: boolean) {
    const root = this.root(rootName);
    const rootPath = await realpath(root.uri.fsPath);
    const candidate = path.resolve(rootPath, relativePath);
    if (!pathIsInside(rootPath, candidate)) throw new Error("Path escapes the workspace");
    if (mustExist) {
      const resolved = await realpath(candidate);
      this.assertInside(rootPath, resolved);
      return vscode.Uri.file(resolved);
    }
    const existing = await realpathIfExists(candidate);
    if (existing) {
      this.assertInside(rootPath, existing);
      return vscode.Uri.file(existing);
    }
    let ancestor = path.dirname(candidate);
    while (true) {
      const resolvedAncestor = await realpathIfExists(ancestor);
      if (!resolvedAncestor) {
        const next = path.dirname(ancestor);
        if (next === ancestor) throw new Error("Unable to resolve a writable workspace parent");
        ancestor = next;
        continue;
      }
      this.assertInside(rootPath, resolvedAncestor);
      break;
    }
    return vscode.Uri.file(candidate);
  }

  private assertInside(root: string, candidate: string): void {
    if (!pathIsInside(root, candidate)) {
      throw new Error("Path escapes the workspace through a symbolic link");
    }
  }
}

async function realpathIfExists(candidate: string): Promise<string | undefined> {
  try {
    return await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
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
    let settled = false;
    const append = (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output);
      if (remaining > 0) output += chunk.subarray(0, remaining).toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const stop = () => child.kill("SIGTERM");
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, timeoutMs);
    child.once("error", (error) => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    child.once("close", (code, closeSignal) => {
      if (settled) return;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(new Error("Command stopped by user"));
      else if (code === 0) resolve(output || "Command completed with no output.");
      else
        reject(
          new Error(`Command exited with code ${code ?? closeSignal ?? "unknown"}\n${output}`),
        );
    });
  });
}
