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
  keychainSet: vi.fn(() => Promise.resolve()),
  read: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
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
  });

  it("does nothing outside the native desktop runtime", async () => {
    mocks.native = false;
    await initializeRuntimeStorage();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.keychainSet).not.toHaveBeenCalled();
  });

  it("moves provider secrets to Keychain and migrates structured records", async () => {
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
    expect(mocks.write).toHaveBeenCalledWith("settings", "desktopStructuredStorageMigrationV1", {
      name: "desktopStructuredStorageMigrationV1",
      value: true,
    });
  });

  it("does not repeat a completed migration", async () => {
    mocks.read.mockResolvedValue({
      name: "desktopStructuredStorageMigrationV1",
      value: true,
    });

    await initializeRuntimeStorage();
    expect(mocks.keychainSet).not.toHaveBeenCalled();
    expect(mocks.writeMany).not.toHaveBeenCalled();
  });
});
