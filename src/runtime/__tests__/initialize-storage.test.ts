import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopStorageAdapter } from "../desktop-storage-adapter";
import type { StoragePort } from "../../core/storage/storage-port";
import type { ProviderRecord } from "../../core/storage/db";

const mocks = vi.hoisted(() => ({
  native: true,
  providerRows: [] as ProviderRecord[],
  providerBulkPut: vi.fn(() => Promise.resolve()),
  conversationRows: vi.fn(() => Promise.resolve([{ id: "c1" }])),
  messageRows: vi.fn(() => Promise.resolve([{ id: "m1" }])),
  attachmentRows: vi.fn(() => Promise.resolve([{ id: "a1" }])),
  usageRows: vi.fn(() => Promise.resolve([{ id: "u1" }])),
  mcpRows: vi.fn(() => Promise.resolve([{ id: "server1" }])),
  settingRows: vi.fn(() => Promise.resolve([{ name: "theme", value: "dark" }])),
  memoryRows: vi.fn(() => Promise.resolve([{ id: "memory1" }])),
  keychainSet: vi.fn(() => Promise.resolve()),
  keychainGet: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  read: vi.fn((entity: string, id: string): Promise<unknown> => {
    void entity;
    void id;
    return Promise.resolve(undefined);
  }),
  readAll: vi.fn(() => Promise.resolve([])),
  write: vi.fn(() => Promise.resolve()),
  writeMany: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../core/storage/db", () => ({
  db: {
    providers: {
      toArray: () => Promise.resolve(mocks.providerRows),
      bulkPut: mocks.providerBulkPut,
    },
    conversations: { toArray: mocks.conversationRows },
    messages: { toArray: mocks.messageRows },
    attachments: { toArray: mocks.attachmentRows },
    usage_records: { toArray: mocks.usageRows },
    mcpServers: { toArray: mocks.mcpRows },
    settings: { toArray: mocks.settingRows },
    memories: { toArray: mocks.memoryRows },
  },
}));

const structuredStorage: StoragePort = {
  read: mocks.read as StoragePort["read"],
  readAll: mocks.readAll,
  write: mocks.write,
  writeMany: mocks.writeMany,
  delete: vi.fn(() => Promise.resolve()),
  deleteMany: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  query: vi.fn(() => Promise.resolve([])),
  apply: vi.fn(() => Promise.resolve()),
};

const secureStorage = {
  keychainSet: mocks.keychainSet,
  keychainGet: mocks.keychainGet,
} as unknown as DesktopStorageAdapter;

vi.mock("../use-runtime", () => ({
  isNativeDesktopRuntime: () => mocks.native,
  getRuntime: () => ({ structuredStorage, storage: secureStorage }),
}));

import { initializeRuntimeStorage } from "../initialize-storage";

const provider: ProviderRecord = {
  id: "p1",
  name: "OpenAI",
  protocolId: "openai-chat-completions",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "secret-key",
  modelId: "gpt-test",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("initializeRuntimeStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.native = true;
    mocks.providerRows = [provider];
    mocks.read.mockResolvedValue(undefined);
    mocks.readAll.mockResolvedValue([]);
    mocks.keychainGet.mockResolvedValue(null);
  });

  it("does nothing outside the native desktop runtime", async () => {
    mocks.native = false;
    await initializeRuntimeStorage();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.keychainSet).not.toHaveBeenCalled();
  });

  it("moves provider secrets to Keychain and migrates structured records", async () => {
    mocks.keychainGet.mockResolvedValue("secret-key");
    await initializeRuntimeStorage();

    expect(mocks.keychainSet).toHaveBeenCalledWith("provider:p1:api-key", "secret-key");
    expect(mocks.writeMany).toHaveBeenCalledWith("providers", [
      expect.objectContaining({ id: "p1", apiKey: "" }),
    ]);
    expect(mocks.providerBulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ id: "p1", apiKey: "" }),
    ]);
    expect(mocks.writeMany).toHaveBeenCalledWith("conversations", [{ id: "c1" }]);
    expect(mocks.writeMany).toHaveBeenCalledWith("messages", [{ id: "m1" }]);
    expect(mocks.writeMany).toHaveBeenCalledWith("attachments", [{ id: "a1" }]);
    expect(mocks.writeMany).toHaveBeenCalledWith("usage_records", [{ id: "u1" }]);
    expect(mocks.writeMany).toHaveBeenCalledWith("mcp_servers", [{ id: "server1" }]);
    expect(mocks.writeMany).toHaveBeenCalledWith("settings", [{ name: "theme", value: "dark" }]);
    expect(mocks.writeMany).toHaveBeenCalledWith("memories", [{ id: "memory1" }]);
    expect(mocks.write).toHaveBeenCalledWith("settings", "desktopStructuredStorageMigrationV1", {
      name: "desktopStructuredStorageMigrationV1",
      value: true,
    });
    expect(mocks.write).toHaveBeenCalledWith("settings", "desktopStructuredStorageMigrationV2", {
      name: "desktopStructuredStorageMigrationV2",
      value: true,
    });
  });

  it("does not repeat a completed migration", async () => {
    mocks.read.mockImplementation((entity, id) => {
      void entity;
      return Promise.resolve({ name: id, value: true });
    });

    await initializeRuntimeStorage();
    expect(mocks.keychainSet).not.toHaveBeenCalled();
    expect(mocks.writeMany).not.toHaveBeenCalled();
  });
});
