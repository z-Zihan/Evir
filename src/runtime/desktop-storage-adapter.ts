import { invoke } from "@tauri-apps/api/core";
import { getActivePermissionContext, getActiveWorkspaceRoot } from "../core/workspace/active-root";
import { logger } from "../core/logging/logger";
import { isInsideRoots } from "../core/security/permission-profiles";
import type { EntityName, StorageMutation, StoragePort } from "../core/storage/storage-port";
import { ipcRetryStore } from "./ipc-retry-store";

export interface DesktopStorageAdapter {
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  update(sql: string, params: unknown[]): Promise<number>;
  keychainSet(key: string, value: string): Promise<void>;
  keychainGet(key: string): Promise<string | null>;
  keychainDelete(key: string): Promise<void>;
  sharedProviderProfilesRead(): Promise<SharedProviderProfile[]>;
  sharedProviderProfilesWrite(
    profiles: SharedProviderProfile[],
    deletedIds?: string[],
  ): Promise<void>;
  readFile(path: string, corr?: IpcCorrelation): Promise<string>;
  /** Base64 content for binary preview (images, PDFs); 8 MiB cap on the Rust side. */
  readFileBase64(path: string, corr?: IpcCorrelation): Promise<string>;
  realPath(path: string, corr?: IpcCorrelation): Promise<string>;
  gitWorktreeCreate(root: string, id: string): Promise<string>;
  gitWorktreeMerge(root: string, id: string): Promise<void>;
  gitWorktreeRemove(root: string, id: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string, corr?: IpcCorrelation): Promise<FileInfo[]>;
  fileInfo(path: string, corr?: IpcCorrelation): Promise<FileInfo>;
  applyPatch(path: string, oldContent: string, newContent: string): Promise<void>;
  searchFiles(path: string, pattern: string, corr?: IpcCorrelation): Promise<string[]>;
  runCommand(
    cwd: string,
    program: string,
    args: string[],
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<CommandResult>;
  cancelActiveCommands(): Promise<void>;
  gitStatus(path: string, corr?: IpcCorrelation): Promise<GitStatusResult>;
  gitDiff(path: string, staged: boolean, corr?: IpcCorrelation): Promise<string>;
  createDirectory(path: string): Promise<void>;
  fileStat(path: string, corr?: IpcCorrelation): Promise<FileStat>;
  /** Reveals a workspace file in Finder/Explorer (selected where supported). */
  revealInFileManager(path: string): Promise<void>;
  createSnapshot(filePath: string, runId: string): Promise<SnapshotResult>;
  sealSnapshot(snapshotId: string, runId: string, filePath: string): Promise<void>;
  restoreSnapshot(snapshotId: string, runId: string, filePath: string): Promise<boolean>;
}

export interface SharedProviderProfile {
  id: string;
  name: string;
  protocolId: string;
  baseUrl: string;
  modelId: string;
  toolCalling: boolean;
  maxContextTokens?: number;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  success: boolean;
}

export interface GitStatusEntry {
  status: string;
  file: string;
}

export interface FileStat {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  is_symlink: boolean;
  size: number;
  modified: number | null;
  exists: boolean;
}

export interface SnapshotResult {
  snapshot_id: string;
  file_path: string;
  existed: boolean;
  original_hash: string | null;
}

export interface GitStatusResult {
  is_repo: boolean;
  entries: GitStatusEntry[];
  branch: string | null;
}

function selectedWorkspace(): string {
  return getActiveWorkspaceRoot() ?? "";
}

/**
 * On macOS, `invoke` from a custom-scheme page (`tauri://localhost`) is served
 * through the `ipc://localhost` WKURLSchemeHandler. Under macOS 26.5 that
 * handler intermittently stalls a subresource request for ~100s before it is
 * delivered (observed with structured-log breadcrumbs: `listdir.invoke` at
 * T, `listdir.done` at T+97.7s, with the Rust process idle the whole time and
 * the app's main thread in a normal runloop wait). Dev builds serve the page
 * from an http origin and use postMessage IPC instead, which is why the stall
 * only reproduces in release builds (tauri#7662 documents this split).
 *
 * Reads are idempotent, so a bounded timeout + retry keeps agent tool calls
 * alive instead of hanging on the platform stall. Mutating commands are NOT
 * retried here — re-issuing them is not provably safe. Every attempt is
 * observable via the `desktop.ipc.duration/timeout/retry/retry-recovered`
 * runtime events (command / attempt / maxAttempts / durationMs / runId /
 * toolCallId), and the first timeout raises a low-noise UI retry state
 * (ipc-retry-store) so the chat never shows a fake "thinking" hang.
 *
 * Workaround removal condition: upgrade wry/tauri past the fix for
 * tauri#7662 (or macOS fixes the WKURLSchemeHandler stall) and verify a
 * release build no longer stalls `invoke` — then drop this wrapper.
 */
const IPC_READ_ATTEMPT_TIMEOUT_MS = 10_000;
const IPC_READ_MAX_ATTEMPTS = 3;

export type { IpcCorrelation } from "./ipc-correlation";
import type { IpcCorrelation } from "./ipc-correlation";

function ipcFields(command: string, attempt: number, durationMs: number, corr?: IpcCorrelation) {
  return {
    command,
    attempt,
    maxAttempts: IPC_READ_MAX_ATTEMPTS,
    durationMs,
    ...(corr?.conversationId ? { conversationId: corr.conversationId } : {}),
    ...(corr?.runId ? { runId: corr.runId } : {}),
    ...(corr?.toolCallId ? { toolCallId: corr.toolCallId } : {}),
  };
}

async function invokeReadWithRetry<T>(
  label: string,
  run: () => Promise<T>,
  corr?: IpcCorrelation,
): Promise<T> {
  class IpcReadTimeout extends Error {}
  let timedOut = false;
  for (let attempt = 1; attempt <= IPC_READ_MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        run(),
        new Promise<never>((_, reject) =>
          globalThis.setTimeout(
            () => reject(new IpcReadTimeout(`ipc read ${label} timed out (attempt ${attempt})`)),
            IPC_READ_ATTEMPT_TIMEOUT_MS,
          ),
        ),
      ]);
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        logger.warn("runtime", "desktop.ipc.retry-recovered", {
          ...ipcFields(label, attempt, durationMs, corr),
        });
        ipcRetryStore.end(corr?.toolCallId ?? label);
      } else {
        logger.debug("runtime", "desktop.ipc.duration", {
          ...ipcFields(label, attempt, durationMs, corr),
        });
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      // Real command failures reject immediately with the handler's error —
      // surface those on the first attempt. Only the platform stall (our
      // timeout) justifies re-issuing the read.
      if (!(error instanceof IpcReadTimeout)) throw error;
      timedOut = true;
      logger.warn("runtime", "desktop.ipc.timeout", {
        ...ipcFields(label, attempt, durationMs, corr),
      });
      if (attempt < IPC_READ_MAX_ATTEMPTS) {
        logger.warn("runtime", "desktop.ipc.retry", {
          ...ipcFields(label, attempt, durationMs, corr),
        });
        ipcRetryStore.begin(corr?.toolCallId ?? label, {
          command: label,
          attempt,
          maxAttempts: IPC_READ_MAX_ATTEMPTS,
          ...(corr ?? {}),
        });
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250 * attempt));
      } else {
        ipcRetryStore.end(corr?.toolCallId ?? label);
        throw error;
      }
    }
  }
  ipcRetryStore.end(corr?.toolCallId ?? label);
  throw new Error(`ipc read ${label} failed`);
}

/**
 * The Rust boundary validates each path against a single workspace root, so
 * with multiple granted roots (additional access) or Full Access the root that
 * actually contains the path is passed per command.
 */
function rootForPath(path: string): string {
  const context = getActivePermissionContext();
  if (context?.profile === "full") return path;
  if (context && context.roots.length > 0) {
    const active = selectedWorkspace();
    // Containment must go through isInsideRoots (normalized comparison) — a raw
    // prefix check silently misses backslash or trailing-slash root spellings
    // and then submits the wrong root to the Rust validator.
    const containing = context.roots.find((root) => isInsideRoots(path, [root]));
    return containing ?? (active || context.roots[0] || "");
  }
  return selectedWorkspace();
}

const activeCommandIds = new Set<string>();

export const desktopStorage: DesktopStorageAdapter = {
  query: (sql, params) => invoke("db_query", { sql, params }),
  update: (sql, params) => invoke("db_update", { sql, params }),
  keychainSet: (key, value) => invoke("keychain_set", { key, value }),
  keychainGet: (key) => invoke("keychain_get", { key }),
  keychainDelete: (key) => invoke("keychain_delete", { key }),
  sharedProviderProfilesRead: () => invoke("shared_provider_profiles_read"),
  sharedProviderProfilesWrite: (profiles, deletedIds = []) =>
    invoke("shared_provider_profiles_write", { profiles, deletedIds }),
  readFile: (path, corr) =>
    invokeReadWithRetry(
      "fs_read_file",
      () => invoke<string>("fs_read_file", { path, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  readFileBase64: (path, corr) =>
    invokeReadWithRetry(
      "fs_read_file_base64",
      () => invoke<string>("fs_read_file_base64", { path, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  realPath: (path, corr) =>
    invokeReadWithRetry("fs_real_path", () => invoke<string>("fs_real_path", { path }), corr),
  gitWorktreeCreate: (root, id) => invoke("git_worktree_create", { root, id }),
  gitWorktreeMerge: (root, id) => invoke("git_worktree_merge", { root, id }),
  gitWorktreeRemove: (root, id) => invoke("git_worktree_remove", { root, id }),
  writeFile: (path, content) =>
    invoke("fs_write_file", { path, content, workspaceRoot: rootForPath(path) }),
  listDir: (path, corr) =>
    invokeReadWithRetry(
      "fs_list_dir",
      () => invoke<FileInfo[]>("fs_list_dir", { path, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  fileInfo: (path, corr) =>
    invokeReadWithRetry(
      "fs_file_info",
      () => invoke<FileInfo>("fs_file_info", { path, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  applyPatch: (path, oldContent, newContent) =>
    invoke("fs_apply_patch", {
      path,
      oldContent,
      newContent,
      workspaceRoot: rootForPath(path),
    }),
  searchFiles: (path, pattern, corr) =>
    invokeReadWithRetry(
      "fs_search_files",
      () =>
        invoke<string[]>("fs_search_files", { path, pattern, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  runCommand: async (cwd, program, args, timeoutMs, env) => {
    const commandId = crypto.randomUUID();
    activeCommandIds.add(commandId);
    try {
      return await invoke("run_command", {
        commandId,
        cwd,
        program,
        args,
        timeoutMs,
        env: env ?? null,
        workspaceRoot: rootForPath(cwd),
      });
    } finally {
      activeCommandIds.delete(commandId);
    }
  },
  cancelActiveCommands: async () => {
    await Promise.all(
      [...activeCommandIds].map((commandId) => invoke("cancel_command", { commandId })),
    );
  },
  gitStatus: (path, corr) =>
    invokeReadWithRetry(
      "git_status",
      () => invoke<GitStatusResult>("git_status", { path, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  gitDiff: (path, staged, corr) =>
    invokeReadWithRetry(
      "git_diff",
      () => invoke<string>("git_diff", { path, staged, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  createDirectory: (path) =>
    invoke("fs_create_directory", { path, workspaceRoot: rootForPath(path) }),
  fileStat: (path, corr) =>
    invokeReadWithRetry(
      "fs_file_stat",
      () => invoke<FileStat>("fs_file_stat", { path, workspaceRoot: rootForPath(path) }),
      corr,
    ),
  revealInFileManager: (path) =>
    invoke("fs_reveal_in_file_manager", { path, workspaceRoot: rootForPath(path) }),
  createSnapshot: (filePath, runId) =>
    invoke("fs_create_snapshot", { filePath, runId, workspaceRoot: rootForPath(filePath) }),
  sealSnapshot: (snapshotId, runId, filePath) =>
    invoke("fs_seal_snapshot", {
      snapshotId,
      runId,
      filePath,
      workspaceRoot: rootForPath(filePath),
    }),
  restoreSnapshot: (snapshotId, runId, filePath) =>
    invoke("fs_restore_snapshot", {
      snapshotId,
      runId,
      filePath,
      workspaceRoot: rootForPath(filePath),
    }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DesktopStructuredStorageAdapter implements StoragePort {
  read<T>(entity: EntityName, id: string): Promise<T | undefined> {
    return invoke<T | null>("entity_get", { entity, id }).then((value) => value ?? undefined);
  }

  readAll<T>(entity: EntityName): Promise<T[]> {
    return invoke<T[]>("entity_list", { entity });
  }

  async write<T>(entity: EntityName, id: string, data: T): Promise<void> {
    if (!isRecord(data)) throw new TypeError(`Storage entity ${entity} must be an object`);
    await invoke("entity_put", { entity, id, data });
  }

  async writeMany<T>(entity: EntityName, data: T[]): Promise<void> {
    if (!data.every(isRecord)) throw new TypeError(`Storage entity ${entity} must contain objects`);
    await invoke("entity_put_many", { entity, records: data });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await invoke("entity_delete", { entity, id });
  }

  async deleteMany(entity: EntityName, ids: string[]): Promise<void> {
    await invoke("entity_delete_many", { entity, ids });
  }

  async clear(entity: EntityName): Promise<void> {
    await invoke("entity_clear", { entity });
  }

  async query<T>(entity: EntityName, filter: Partial<T>): Promise<T[]> {
    if (!isRecord(filter)) return [];
    const entries = Object.entries(filter);
    const records = await this.readAll<T>(entity);
    return records.filter(
      (record) => isRecord(record) && entries.every(([key, value]) => record[key] === value),
    );
  }

  async apply(mutations: StorageMutation[]): Promise<void> {
    await invoke("entity_apply", { mutations });
  }
}

export const desktopStructuredStorage = new DesktopStructuredStorageAdapter();
