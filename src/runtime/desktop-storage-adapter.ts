import { invoke } from "@tauri-apps/api/core";

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
  ): Promise<CommandResult>;
  gitStatus(path: string): Promise<GitStatusResult>;
  gitDiff(path: string, staged: boolean): Promise<string>;
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

export interface GitStatusResult {
  is_repo: boolean;
  entries: GitStatusEntry[];
  branch: string | null;
}

export const desktopStorage: DesktopStorageAdapter = {
  query: (sql, params) => invoke("db_query", { sql, params }),
  update: (sql, params) => invoke("db_update", { sql, params }),
  keychainSet: (key, value) => invoke("keychain_set", { key, value }),
  keychainGet: (key) => invoke("keychain_get", { key }),
  keychainDelete: (key) => invoke("keychain_delete", { key }),
  readFile: (path) => invoke("fs_read_file", { path }),
  writeFile: (path, content) => invoke("fs_write_file", { path, content }),
  listDir: (path) => invoke("fs_list_dir", { path }),
  fileInfo: (path) => invoke("fs_file_info", { path }),
  applyPatch: (path, oldContent, newContent) =>
    invoke("fs_apply_patch", { path, oldContent, newContent }),
  searchFiles: (path, pattern) => invoke("fs_search_files", { path, pattern }),
  runCommand: (cwd, program, args, timeoutMs) =>
    invoke("run_command", { cwd, program, args, timeoutMs }),
  gitStatus: (path) => invoke("git_status", { path }),
  gitDiff: (path, staged) => invoke("git_diff", { path, staged }),
};
