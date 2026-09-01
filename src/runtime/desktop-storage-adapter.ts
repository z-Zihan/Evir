import { invoke } from "@tauri-apps/api/core";
import { getActivePermissionContext, getActiveWorkspaceRoot } from "../core/workspace/active-root";
import { isInsideRoots } from "../core/security/permission-profiles";
import type { EntityName, StorageMutation, StoragePort } from "../core/storage/storage-port";

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
  readFile(path: string): Promise<string>;
  /** Base64 content for binary preview (images, PDFs); 8 MiB cap on the Rust side. */
  readFileBase64(path: string): Promise<string>;
  realPath(path: string): Promise<string>;
  gitWorktreeCreate(root: string, id: string): Promise<string>;
  gitWorktreeMerge(root: string, id: string): Promise<void>;
  gitWorktreeRemove(root: string, id: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<FileInfo[]>;
  fileInfo(path: string): Promise<FileInfo>;
  applyPatch(path: string, oldContent: string, newContent: string): Promise<void>;
  searchFiles(path: string, pattern: string): Promise<string[]>;
  runCommand(
    cwd: string,
    program: string,
    args: string[],
    timeoutMs?: number,
    env?: Record<string, string>,
  ): Promise<CommandResult>;
  cancelActiveCommands(): Promise<void>;
  gitStatus(path: string): Promise<GitStatusResult>;
  gitDiff(path: string, staged: boolean): Promise<string>;
  createDirectory(path: string): Promise<void>;
  fileStat(path: string): Promise<FileStat>;
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
  readFile: (path) => invoke("fs_read_file", { path, workspaceRoot: rootForPath(path) }),
  readFileBase64: (path) =>
    invoke("fs_read_file_base64", { path, workspaceRoot: rootForPath(path) }),
  realPath: (path) => invoke("fs_real_path", { path }),
  gitWorktreeCreate: (root, id) => invoke("git_worktree_create", { root, id }),
  gitWorktreeMerge: (root, id) => invoke("git_worktree_merge", { root, id }),
  gitWorktreeRemove: (root, id) => invoke("git_worktree_remove", { root, id }),
  writeFile: (path, content) =>
    invoke("fs_write_file", { path, content, workspaceRoot: rootForPath(path) }),
  listDir: (path) => invoke("fs_list_dir", { path, workspaceRoot: rootForPath(path) }),
  fileInfo: (path) => invoke("fs_file_info", { path, workspaceRoot: rootForPath(path) }),
  applyPatch: (path, oldContent, newContent) =>
    invoke("fs_apply_patch", {
      path,
      oldContent,
      newContent,
      workspaceRoot: rootForPath(path),
    }),
  searchFiles: (path, pattern) =>
    invoke("fs_search_files", { path, pattern, workspaceRoot: rootForPath(path) }),
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
  gitStatus: (path) => invoke("git_status", { path, workspaceRoot: rootForPath(path) }),
  gitDiff: (path, staged) => invoke("git_diff", { path, staged, workspaceRoot: rootForPath(path) }),
  createDirectory: (path) =>
    invoke("fs_create_directory", { path, workspaceRoot: rootForPath(path) }),
  fileStat: (path) => invoke("fs_file_stat", { path, workspaceRoot: rootForPath(path) }),
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
