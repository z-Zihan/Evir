import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CommandResult,
  DesktopStorageAdapter,
  FileInfo,
  FileStat,
  GitStatusResult,
  SnapshotResult,
} from "../../src/runtime/desktop-storage-adapter";

/**
 * Node.js implementation of the desktop storage adapter for Agent Eval runs:
 * the REAL builtin tools (read/write/patch/search/run_command/git/snapshots)
 * execute against a temp fixture workspace through this adapter — no Tauri,
 * no mocks at the tool boundary. Workspace containment is enforced here the
 * same way the Rust side enforces it (path escape → error).
 */

function workspaceResolve(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error("path escapes the workspace root");
  }
  return resolved;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function run(
  program: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Uint8Array) => (stdout += Buffer.from(chunk).toString("utf8")));
    child.stderr.on("data", (chunk: Uint8Array) => (stderr += Buffer.from(chunk).toString("utf8")));
    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, 200_000),
        stderr: stderr.slice(0, 100_000),
        exit_code: code,
        success: code === 0,
      });
    };
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: error.message, exit_code: -1, success: false });
    });
    child.on("close", (code) => finish(code));
  });
}

/** In-memory + on-disk snapshot chain (pre-mutation file states). */
interface EvalSnapshot {
  filePath: string;
  content: string | null;
}

export function createNodeStorageAdapter(root: string): DesktopStorageAdapter {
  const snapshots = new Map<string, EvalSnapshot>();
  let snapshotCounter = 0;

  return {
    // Raw SQLite/keychain surfaces are desktop-only plumbing; the eval harness
    // never exercises them.
    query: () => Promise.resolve([]),
    update: () => Promise.resolve(0),
    keychainSet: () => Promise.resolve(),
    keychainGet: () => Promise.resolve(null),
    keychainDelete: () => Promise.resolve(),
    sharedProviderProfilesRead: () => Promise.resolve([]),
    sharedProviderProfilesWrite: () => Promise.resolve(),
    readFile: async (relative) => fs.readFile(workspaceResolve(root, relative), "utf8"),
    readFileBase64: async (relative) =>
      (await fs.readFile(workspaceResolve(root, relative))).toString("base64"),
    realPath: (relative) => Promise.resolve(workspaceResolve(root, relative)),
    writeFile: async (relative, content) => {
      const target = workspaceResolve(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    },
    listDir: async (relative) => {
      const target = workspaceResolve(root, relative);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const infos: FileInfo[] = [];
      for (const entry of entries) {
        const full = path.join(target, entry.name);
        const stat = await fs.stat(full).catch(() => null);
        infos.push({
          name: entry.name,
          path: path.relative(root, full),
          is_dir: entry.isDirectory(),
          size: stat?.size ?? 0,
          modified: stat?.mtimeMs ?? null,
        });
      }
      return infos;
    },
    fileInfo: async (relative) => {
      const target = workspaceResolve(root, relative);
      const stat = await fs.stat(target);
      return {
        name: path.basename(target),
        path: path.relative(root, target),
        is_dir: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtimeMs,
      } satisfies FileInfo;
    },
    applyPatch: async (relative, oldContent, newContent) => {
      const target = workspaceResolve(root, relative);
      const current = (await pathExists(target)) ? await fs.readFile(target, "utf8") : "";
      if (!current.includes(oldContent)) {
        throw new Error("old_content not found in target file");
      }
      await fs.writeFile(target, current.replace(oldContent, newContent), "utf8");
    },
    searchFiles: async (relative, pattern) => {
      const target = workspaceResolve(root, relative);
      const regex = new RegExp(pattern, "g");
      const hits: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (/\.(js|mjs|cjs|ts|tsx|jsx|json|md|css|html|txt)$/.test(entry.name)) {
            const content = await fs.readFile(full, "utf8");
            const lines = content.split("\n");
            lines.forEach((line, index) => {
              regex.lastIndex = 0;
              if (regex.test(line)) {
                hits.push(
                  `${path.relative(root, full)}:${index + 1}: ${line.trim().slice(0, 120)}`,
                );
              }
            });
          }
        }
      };
      await walk(target);
      return hits.slice(0, 200);
    },
    runCommand: (cwd, program, args, timeoutMs) =>
      run(program, args, cwd ? workspaceResolve(root, cwd) : root, timeoutMs ?? 30_000),
    cancelActiveCommands: () => Promise.resolve(),
    gitStatus: async (relative) => {
      const target = workspaceResolve(root, relative);
      const result = await run("git", ["status", "--porcelain=v1", "-b"], target);
      const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
      const branch = lines[0]?.replace(/^## /, "").split("...")[0] ?? null;
      const entries = lines
        .filter((line) => !line.startsWith("##"))
        .map((line) => ({
          status: line.slice(0, 2).trim(),
          file: line.slice(3).trim().replace(/\\/g, "/"),
        }));
      return { is_repo: result.success, entries, branch } satisfies GitStatusResult;
    },
    gitDiff: async (relative, staged) => {
      const target = workspaceResolve(root, relative);
      const result = await run("git", staged ? ["diff", "--cached"] : ["diff"], target);
      return result.stdout;
    },
    createDirectory: async (relative) => {
      await fs.mkdir(workspaceResolve(root, relative), { recursive: true });
    },
    fileStat: async (relative) => {
      const target = workspaceResolve(root, relative);
      const stat = await fs.stat(target);
      return {
        name: path.basename(target),
        path: path.relative(root, target),
        is_dir: stat.isDirectory(),
        is_file: stat.isFile(),
        is_symlink: stat.isSymbolicLink(),
        size: stat.size,
        modified: stat.mtimeMs,
        exists: true,
      } satisfies FileStat;
    },
    revealInFileManager: () => Promise.resolve(),
    createSnapshot: async (filePath) => {
      const target = workspaceResolve(root, filePath);
      const existed = await pathExists(target);
      const content = existed ? await fs.readFile(target, "utf8") : null;
      snapshotCounter += 1;
      const id = `eval-snap-${snapshotCounter}`;
      snapshots.set(id, { filePath: target, content });
      return {
        snapshot_id: id,
        file_path: target,
        existed,
        original_hash: null,
      } satisfies SnapshotResult;
    },
    sealSnapshot: (snapshotId) => {
      if (!snapshots.has(snapshotId)) return Promise.reject(new Error("unknown snapshot"));
      return Promise.resolve();
    },
    restoreSnapshot: async (snapshotId) => {
      const snapshot = snapshots.get(snapshotId);
      if (!snapshot) throw new Error("unknown snapshot");
      if (snapshot.content === null) await fs.rm(snapshot.filePath, { force: true });
      else await fs.writeFile(snapshot.filePath, snapshot.content, "utf8");
      return true;
    },
    gitWorktreeCreate: () =>
      Promise.reject(new Error("worktrees are not supported by the eval adapter")),
    gitWorktreeMerge: () =>
      Promise.reject(new Error("worktrees are not supported by the eval adapter")),
    gitWorktreeRemove: () =>
      Promise.reject(new Error("worktrees are not supported by the eval adapter")),
  } satisfies DesktopStorageAdapter;
}
