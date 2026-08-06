// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopStorage } from "../desktop-storage-adapter";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("DesktopStorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("evir-workspace-current", "/tmp");
  });

  it("queries SQLite", async () => {
    vi.mocked(invoke).mockResolvedValue([{ id: 1 }]);

    await expect(desktopStorage.query("SELECT * FROM providers", [])).resolves.toEqual([{ id: 1 }]);
    expect(invoke).toHaveBeenCalledWith("db_query", { sql: "SELECT * FROM providers", params: [] });
  });

  it("updates SQLite", async () => {
    vi.mocked(invoke).mockResolvedValue(1);
    const sql = "INSERT INTO settings VALUES (?, ?)";
    const params = ["theme", "dark"];

    await expect(desktopStorage.update(sql, params)).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith("db_update", { sql, params });
  });

  it("sets a keychain value", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await desktopStorage.keychainSet("api-key", "secret");
    expect(invoke).toHaveBeenCalledWith("keychain_set", { key: "api-key", value: "secret" });
  });

  it("gets a keychain value", async () => {
    vi.mocked(invoke).mockResolvedValue("secret");

    await expect(desktopStorage.keychainGet("api-key")).resolves.toBe("secret");
    expect(invoke).toHaveBeenCalledWith("keychain_get", { key: "api-key" });
  });

  it("deletes a keychain value", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await desktopStorage.keychainDelete("api-key");
    expect(invoke).toHaveBeenCalledWith("keychain_delete", { key: "api-key" });
  });

  it("reads a file", async () => {
    vi.mocked(invoke).mockResolvedValue("file content");

    await expect(desktopStorage.readFile("/tmp/test.txt")).resolves.toBe("file content");
    expect(invoke).toHaveBeenCalledWith("fs_read_file", {
      path: "/tmp/test.txt",
      workspaceRoot: "/tmp",
    });
  });

  it("writes a file", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await desktopStorage.writeFile("/tmp/test.txt", "content");
    expect(invoke).toHaveBeenCalledWith("fs_write_file", {
      path: "/tmp/test.txt",
      content: "content",
      workspaceRoot: "/tmp",
    });
  });

  it("lists a directory", async () => {
    const files = [
      { name: "test.txt", path: "/tmp/test.txt", is_dir: false, size: 100, modified: null },
    ];
    vi.mocked(invoke).mockResolvedValue(files);

    await expect(desktopStorage.listDir("/tmp")).resolves.toEqual(files);
    expect(invoke).toHaveBeenCalledWith("fs_list_dir", { path: "/tmp", workspaceRoot: "/tmp" });
  });

  it("gets file information", async () => {
    const info = {
      name: "test.txt",
      path: "/tmp/test.txt",
      is_dir: false,
      size: 100,
      modified: null,
    };
    vi.mocked(invoke).mockResolvedValue(info);

    await expect(desktopStorage.fileInfo("/tmp/test.txt")).resolves.toEqual(info);
    expect(invoke).toHaveBeenCalledWith("fs_file_info", {
      path: "/tmp/test.txt",
      workspaceRoot: "/tmp",
    });
  });
});
