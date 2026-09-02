// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopStructuredStorageAdapter, desktopStorage } from "../desktop-storage-adapter";

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

  it("reads and writes the shared non-secret Provider profiles", async () => {
    const profiles = [
      {
        id: "provider-1",
        name: "Provider",
        protocolId: "openai-compatible-chat",
        baseUrl: "https://example.com/v1",
        modelId: "model",
        toolCalling: true,
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(profiles).mockResolvedValueOnce(undefined);

    await expect(desktopStorage.sharedProviderProfilesRead()).resolves.toEqual(profiles);
    await desktopStorage.sharedProviderProfilesWrite(profiles, ["removed"]);
    expect(invoke).toHaveBeenNthCalledWith(1, "shared_provider_profiles_read");
    expect(invoke).toHaveBeenNthCalledWith(2, "shared_provider_profiles_write", {
      profiles,
      deletedIds: ["removed"],
    });
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

  it("retries a stalled read invoke and recovers (macOS ipc scheme stall)", async () => {
    vi.useFakeTimers();
    try {
      const files = [{ name: "a.txt", path: "/tmp/a.txt", is_dir: false, size: 1, modified: null }];
      // First invoke never settles (simulates the WKURLSchemeHandler stall);
      // the retried invoke resolves.
      vi.mocked(invoke)
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValueOnce(files);

      const pending = desktopStorage.listDir("/tmp");
      // Let the first attempt hit its timeout, then the backoff, then the retry.
      await vi.advanceTimersByTimeAsync(10_000 + 250);
      await expect(pending).resolves.toEqual(files);
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces real read errors without retrying", async () => {
    const failure = new Error("Path not allowed");
    vi.mocked(invoke).mockRejectedValueOnce(failure);

    await expect(desktopStorage.listDir("/tmp")).rejects.toThrow("Path not allowed");
    expect(invoke).toHaveBeenCalledTimes(1);
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

  it("seals a snapshot after a file mutation", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await desktopStorage.sealSnapshot("snapshot-1", "run-1", "/tmp/test.txt");

    expect(invoke).toHaveBeenCalledWith("fs_seal_snapshot", {
      snapshotId: "snapshot-1",
      runId: "run-1",
      filePath: "/tmp/test.txt",
      workspaceRoot: "/tmp",
    });
  });

  it("cancels an active native command by its generated command id", async () => {
    let finishCommand: ((value: unknown) => void) | undefined;
    vi.mocked(invoke)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishCommand = resolve;
          }),
      )
      .mockResolvedValueOnce(true);

    const command = desktopStorage.runCommand("/tmp", "sleep", ["10"]);
    await desktopStorage.cancelActiveCommands();

    const commandArgs = vi.mocked(invoke).mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(commandArgs?.commandId).toEqual(expect.any(String));
    expect(invoke).toHaveBeenNthCalledWith(2, "cancel_command", {
      commandId: commandArgs?.commandId,
    });

    finishCommand?.({ stdout: "", stderr: "cancelled", exit_code: null, success: false });
    await command;
  });
});

describe("DesktopStructuredStorageAdapter", () => {
  const storage = new DesktopStructuredStorageAdapter();

  beforeEach(() => vi.clearAllMocks());

  it("maps entity reads and normalizes missing records", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "p1" }).mockResolvedValueOnce(null);

    await expect(storage.read("providers", "p1")).resolves.toEqual({ id: "p1" });
    await expect(storage.read("providers", "missing")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(1, "entity_get", {
      entity: "providers",
      id: "p1",
    });
  });

  it("maps entity writes, bulk operations, deletes, and clears", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const record = { id: "p1", name: "Provider" };

    await storage.write("providers", "p1", record);
    await storage.writeMany("providers", [record]);
    await storage.delete("providers", "p1");
    await storage.deleteMany("providers", ["p1", "p2"]);
    await storage.clear("providers");

    expect(invoke).toHaveBeenNthCalledWith(1, "entity_put", {
      entity: "providers",
      id: "p1",
      data: record,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "entity_put_many", {
      entity: "providers",
      records: [record],
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "entity_delete", {
      entity: "providers",
      id: "p1",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "entity_delete_many", {
      entity: "providers",
      ids: ["p1", "p2"],
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "entity_clear", { entity: "providers" });
  });

  it("rejects non-object records before invoking native storage", async () => {
    await expect(storage.write("settings", "bad", "value")).rejects.toThrow(TypeError);
    await expect(storage.writeMany("settings", [{ name: "ok" }, null])).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("filters structured records locally", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { id: "one", enabled: true },
      { id: "two", enabled: false },
      { id: "three", enabled: true },
    ]);

    await expect(storage.query("providers", { enabled: true })).resolves.toEqual([
      { id: "one", enabled: true },
      { id: "three", enabled: true },
    ]);
  });

  it("sends a transaction as one native apply command", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const mutations = [
      { type: "write" as const, entity: "settings" as const, id: "theme", data: { value: "dark" } },
      { type: "delete" as const, entity: "providers" as const, id: "p1" },
      { type: "clear" as const, entity: "messages" as const },
    ];

    await storage.apply(mutations);
    expect(invoke).toHaveBeenCalledWith("entity_apply", { mutations });
  });
});
