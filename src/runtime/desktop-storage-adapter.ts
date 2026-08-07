import { invoke } from "@tauri-apps/api/core";
import type { EntityName, StorageMutation, StoragePort } from "../core/storage/storage-port";

export interface DesktopStorageAdapter {
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  update(sql: string, params: unknown[]): Promise<number>;
  keychainSet(key: string, value: string): Promise<void>;
  keychainGet(key: string): Promise<string | null>;
  keychainDelete(key: string): Promise<void>;
  readFile(path: string): Promise<string>;
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
  return globalThis.localStorage?.getItem("evir-workspace-current") ?? "";
}

const activeCommandIds = new Set<string>();

export const desktopStorage: DesktopStorageAdapter = {
  query: (sql, params) => invoke("db_query", { sql, params }),
  update: (sql, params) => invoke("db_update", { sql, params }),
  keychainSet: (key, value) => invoke("keychain_set", { key, value }),
  keychainGet: (key) => invoke("keychain_get", { key }),
  keychainDelete: (key) => invoke("keychain_delete", { key }),
  readFile: (path) => invoke("fs_read_file", { path, workspaceRoot: selectedWorkspace() }),
  writeFile: (path, content) =>
    invoke("fs_write_file", { path, content, workspaceRoot: selectedWorkspace() }),
  listDir: (path) => invoke("fs_list_dir", { path, workspaceRoot: selectedWorkspace() }),
  fileInfo: (path) => invoke("fs_file_info", { path, workspaceRoot: selectedWorkspace() }),
  applyPatch: (path, oldContent, newContent) =>
    invoke("fs_apply_patch", {
      path,
      oldContent,
      newContent,
      workspaceRoot: selectedWorkspace(),
    }),
  searchFiles: (path, pattern) =>
    invoke("fs_search_files", { path, pattern, workspaceRoot: selectedWorkspace() }),
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
        workspaceRoot: selectedWorkspace(),
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
  gitStatus: (path) => invoke("git_status", { path, workspaceRoot: selectedWorkspace() }),
  gitDiff: (path, staged) =>
    invoke("git_diff", { path, staged, workspaceRoot: selectedWorkspace() }),
  createDirectory: (path) =>
    invoke("fs_create_directory", { path, workspaceRoot: selectedWorkspace() }),
  fileStat: (path) => invoke("fs_file_stat", { path, workspaceRoot: selectedWorkspace() }),
  createSnapshot: (filePath, runId) =>
    invoke("fs_create_snapshot", { filePath, runId, workspaceRoot: selectedWorkspace() }),
  sealSnapshot: (snapshotId, runId, filePath) =>
    invoke("fs_seal_snapshot", {
      snapshotId,
      runId,
      filePath,
      workspaceRoot: selectedWorkspace(),
    }),
  restoreSnapshot: (snapshotId, runId, filePath) =>
    invoke("fs_restore_snapshot", {
      snapshotId,
      runId,
      filePath,
      workspaceRoot: selectedWorkspace(),
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
