import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../../core/storage/db";
import type { SharedProviderProfile } from "../../../runtime/desktop-storage-adapter";

const mocks = vi.hoisted(() => ({
  rows: [] as ProviderRecord[],
  read: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
  readAll: vi.fn((): Promise<ProviderRecord[]> => Promise.resolve([])),
  write: vi.fn(() => Promise.resolve()),
  delete: vi.fn(() => Promise.resolve()),
  keychainSet: vi.fn(() => Promise.resolve()),
  keychainGet: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  keychainDelete: vi.fn(() => Promise.resolve()),
  sharedProviderProfilesRead: vi.fn((): Promise<SharedProviderProfile[]> => Promise.resolve([])),
  sharedProviderProfilesWrite: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../runtime/use-runtime", () => ({
  isNativeDesktopRuntime: () => true,
  getRuntime: () => ({
    structuredStorage: {
      read: mocks.read,
      readAll: () => Promise.resolve(mocks.rows),
      write: mocks.write,
      delete: mocks.delete,
    },
    storage: {
      keychainSet: mocks.keychainSet,
      keychainGet: mocks.keychainGet,
      keychainDelete: mocks.keychainDelete,
      sharedProviderProfilesRead: mocks.sharedProviderProfilesRead,
      sharedProviderProfilesWrite: mocks.sharedProviderProfilesWrite,
    },
  }),
}));

import { useProviderStore } from "../provider-store";

const config = {
  name: "Local model",
  protocolId: "openai-compatible-chat" as const,
  baseUrl: "http://localhost:11434/v1",
  apiKey: "desktop-secret",
  modelId: "local-model",
  toolCalling: true,
  maxContextTokens: 32_768,
};

const storedProvider: ProviderRecord = {
  id: "provider-1",
  name: config.name,
  protocolId: config.protocolId,
  baseUrl: config.baseUrl,
  apiKey: "",
  modelId: config.modelId,
  modelCapabilities: {
    streaming: true,
    toolCalling: true,
    maxContextTokens: config.maxContextTokens,
  },
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("desktop provider persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.keychainGet.mockResolvedValue(null);
    mocks.sharedProviderProfilesRead.mockResolvedValue([]);
    mocks.sharedProviderProfilesWrite.mockResolvedValue(undefined);
    useProviderStore.setState({ providers: [] });
  });

  it("stores API keys only in Keychain", async () => {
    const provider = await useProviderStore.getState().addProvider(config);

    expect(mocks.keychainSet).toHaveBeenCalledWith(
      `provider:${provider.id}:api-key`,
      "desktop-secret",
    );
    expect(mocks.write).toHaveBeenCalledWith(
      "providers",
      provider.id,
      expect.objectContaining({ apiKey: "" }),
    );
    expect(provider.modelCapabilities).toEqual({
      streaming: true,
      toolCalling: true,
      maxContextTokens: 32_768,
    });
    expect(useProviderStore.getState().providers[0]?.apiKey).toBe("desktop-secret");
    expect(mocks.sharedProviderProfilesWrite).toHaveBeenCalledWith(
      [expect.objectContaining({ id: provider.id, name: "Local model" })],
      [],
    );
  });

  it("hydrates the API key from Keychain when loading", async () => {
    mocks.rows = [storedProvider];
    mocks.keychainGet.mockResolvedValue("restored-secret");

    await useProviderStore.getState().loadProviders();

    expect(mocks.keychainGet).toHaveBeenCalledWith("provider:provider-1:api-key");
    expect(useProviderStore.getState().providers[0]?.apiKey).toBe("restored-secret");
  });

  it("imports a newer CLI profile and hydrates its shared credential", async () => {
    mocks.rows = [storedProvider];
    mocks.sharedProviderProfilesRead.mockResolvedValue([
      {
        id: "provider-1",
        name: "Updated from CLI",
        protocolId: "openai-compatible-chat",
        baseUrl: "https://example.com/v1",
        modelId: "new-model",
        toolCalling: false,
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 20,
      },
    ]);
    mocks.keychainGet.mockResolvedValue("shared-secret");

    await useProviderStore.getState().loadProviders();

    expect(mocks.write).toHaveBeenCalledWith(
      "providers",
      "provider-1",
      expect.objectContaining({ name: "Updated from CLI", apiKey: "" }),
    );
    expect(useProviderStore.getState().providers[0]).toEqual(
      expect.objectContaining({ name: "Updated from CLI", apiKey: "shared-secret" }),
    );
  });

  it("deletes both the structured record and its Keychain secret", async () => {
    useProviderStore.setState({ providers: [{ ...storedProvider, apiKey: "restored-secret" }] });

    await useProviderStore.getState().deleteProvider("provider-1");

    expect(mocks.delete).toHaveBeenCalledWith("providers", "provider-1");
    expect(mocks.keychainDelete).toHaveBeenCalledWith("provider:provider-1:api-key");
    expect(mocks.sharedProviderProfilesWrite).toHaveBeenCalledWith([], ["provider-1"]);
    expect(useProviderStore.getState().providers).toEqual([]);
  });
});
