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
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
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
};
