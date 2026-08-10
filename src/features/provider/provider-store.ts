import { create } from "zustand";
import { z } from "zod";
import { getAdapter, listModelsForProtocol } from "../../core/providers/adapter-registry";
import type { ProviderError } from "../../core/providers/stream-events";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import type { ProviderRecord, SettingRecord } from "../../core/storage/db";
import type { StoragePort } from "../../core/storage/storage-port";
import type { SharedProviderProfile } from "../../runtime/desktop-storage-adapter";
import { getRuntime, isNativeDesktopRuntime } from "../../runtime/use-runtime";

const providerSecretKey = (providerId: string) => `provider:${providerId}:api-key`;

function repository(): StoragePort {
  const storage = getRuntime().structuredStorage;
  if (!storage) throw new Error("Structured storage is unavailable");
  return storage;
}

export const providerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  protocolId: z.enum([
    "openai-chat-completions",
    "openai-compatible-chat",
    "anthropic-messages",
    "gemini-generate-content",
    "openai-responses",
  ]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().trim().min(1),
  toolCalling: z.boolean().default(false),
  maxContextTokens: z.number().int().positive().optional(),
});
const updateSchema = providerSchema.extend({ apiKey: z.string().optional() });
export type ProviderConfigInput = z.infer<typeof providerSchema>;
export type ConnectionResult = { ok: boolean; error?: ProviderError };

interface ProviderState {
  providers: ProviderRecord[];
  loadProviders: () => Promise<void>;
  addProvider: (config: ProviderConfigInput) => Promise<ProviderRecord>;
  updateProvider: (
    id: string,
    patch: Partial<ProviderConfigInput> & { enabled?: boolean },
  ) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setDefaultProvider: (id: string) => Promise<void>;
  switchProvider: (providerId: string) => Promise<void>;
  testConnection: (config: ProviderConfigInput) => Promise<ConnectionResult>;
  fetchModels: (config: ProviderConfigInput) => Promise<string[]>;
  getDefaultProvider: () => ProviderRecord | undefined;
}

async function shouldPersistApiKeys(): Promise<boolean> {
  return (await repository().read<SettingRecord>("settings", "persistApiKeys"))?.value !== false;
}

async function persistProvider(provider: ProviderRecord): Promise<void> {
  if (isNativeDesktopRuntime()) {
    const storage = getRuntime().storage;
    if (!storage) throw new Error("Desktop secure storage is unavailable");
    await storage.keychainSet(providerSecretKey(provider.id), provider.apiKey);
    await repository().write("providers", provider.id, { ...provider, apiKey: "" });
    return;
  }
  const persistApiKey = await shouldPersistApiKeys();
  await repository().write("providers", provider.id, {
    ...provider,
    apiKey: persistApiKey ? provider.apiKey : "",
  });
}

function toSharedProfile(provider: ProviderRecord): SharedProviderProfile {
  return {
    id: provider.id,
    name: provider.name,
    protocolId: provider.protocolId,
    baseUrl: provider.baseUrl,
    modelId: provider.modelId,
    toolCalling: provider.modelCapabilities?.toolCalling ?? false,
    ...(provider.modelCapabilities?.maxContextTokens
      ? { maxContextTokens: provider.modelCapabilities.maxContextTokens }
      : {}),
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function fromSharedProfile(
  profile: SharedProviderProfile,
  current?: ProviderRecord,
): ProviderRecord {
  return {
    id: profile.id,
    name: profile.name,
    protocolId: profile.protocolId,
    baseUrl: profile.baseUrl,
    apiKey: current?.apiKey ?? "",
    modelId: profile.modelId,
    modelCapabilities: {
      streaming: current?.modelCapabilities?.streaming ?? true,
      toolCalling: profile.toolCalling,
      ...(profile.maxContextTokens ? { maxContextTokens: profile.maxContextTokens } : {}),
    },
    capabilityEvidence: {
      streaming: current?.capabilityEvidence?.streaming ?? "preset",
      toolCalling: "user-override",
      ...(profile.maxContextTokens ? { maxContextTokens: "user-override" as const } : {}),
    },
    enabled: profile.enabled,
    isDefault: profile.isDefault,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

async function syncSharedProfiles(
  providers: ProviderRecord[],
  deletedIds: string[] = [],
): Promise<void> {
  if (!isNativeDesktopRuntime()) return;
  const storage = getRuntime().storage;
  if (!storage) throw new Error("Desktop secure storage is unavailable");
  await storage.sharedProviderProfilesWrite(providers.map(toSharedProfile), deletedIds);
}

async function hydrateProviderSecret(provider: ProviderRecord): Promise<ProviderRecord> {
  if (!isNativeDesktopRuntime()) return provider;
  const apiKey = await getRuntime().storage?.keychainGet(providerSecretKey(provider.id));
  return { ...provider, apiKey: apiKey ?? "" };
}

function replaceProvider(
  providers: ProviderRecord[],
  replacement: ProviderRecord,
): ProviderRecord[] {
  return providers.map((provider) => (provider.id === replacement.id ? replacement : provider));
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],

  loadProviders: async () => {
    let storedProviders = await repository().readAll<ProviderRecord>("providers");
    if (isNativeDesktopRuntime()) {
      const sharedProfiles = (await getRuntime().storage?.sharedProviderProfilesRead()) ?? [];
      const providersById = new Map(storedProviders.map((provider) => [provider.id, provider]));
      for (const profile of sharedProfiles) {
        const current = providersById.get(profile.id);
        if (!current || profile.updatedAt > current.updatedAt) {
          const imported = fromSharedProfile(profile, current);
          providersById.set(profile.id, imported);
          await repository().write("providers", profile.id, { ...imported, apiKey: "" });
        }
      }
      storedProviders = [...providersById.values()];
      const defaultProvider = storedProviders
        .filter((provider) => provider.enabled && provider.isDefault)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      const fallbackProvider = storedProviders
        .filter((provider) => provider.enabled)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      const selectedDefaultId = defaultProvider?.id ?? fallbackProvider?.id;
      storedProviders = await Promise.all(
        storedProviders.map(async (provider) => {
          const normalized = { ...provider, isDefault: provider.id === selectedDefaultId };
          if (normalized.isDefault !== provider.isDefault) {
            await repository().write("providers", normalized.id, { ...normalized, apiKey: "" });
          }
          return normalized;
        }),
      );
    }
    const providers = await Promise.all(storedProviders.map(hydrateProviderSecret));
    await syncSharedProfiles(providers);
    set({ providers: providers.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  addProvider: async (input) => {
    const config = providerSchema.parse(input);
    const now = Date.now();
    const { toolCalling, maxContextTokens, ...storedConfig } = config;
    const provider: ProviderRecord = {
      id: crypto.randomUUID(),
      ...storedConfig,
      modelCapabilities: {
        streaming: true,
        toolCalling,
        ...(maxContextTokens ? { maxContextTokens } : {}),
      },
      capabilityEvidence: {
        streaming: "preset",
        toolCalling: "user-override",
        ...(maxContextTokens ? { maxContextTokens: "user-override" as const } : {}),
      },
      enabled: true,
      isDefault: get().providers.length === 0,
      createdAt: now,
      updatedAt: now,
    };
    await persistProvider(provider);
    await syncSharedProfiles([provider, ...get().providers]);
    set(({ providers }) => ({ providers: [provider, ...providers] }));
    return provider;
  },

  updateProvider: async (id, patch) => {
    const current = get().providers.find((provider) => provider.id === id);
    if (!current) throw new Error("Provider not found");
    const parsed = updateSchema.parse({
      ...current,
      toolCalling: current.modelCapabilities?.toolCalling ?? false,
      maxContextTokens: current.modelCapabilities?.maxContextTokens,
      ...patch,
    });
    const { apiKey = current.apiKey, toolCalling, maxContextTokens, ...config } = parsed;
    const updated: ProviderRecord = {
      ...current,
      ...config,
      apiKey,
      modelCapabilities: {
        streaming: current.modelCapabilities?.streaming ?? true,
        toolCalling,
        ...(maxContextTokens ? { maxContextTokens } : {}),
      },
      capabilityEvidence: {
        streaming: current.capabilityEvidence?.streaming ?? "preset",
        toolCalling: "user-override",
        ...(maxContextTokens ? { maxContextTokens: "user-override" as const } : {}),
      },
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      updatedAt: Date.now(),
    };
    await persistProvider(updated);
    await syncSharedProfiles(replaceProvider(get().providers, updated));
    set(({ providers }) => ({ providers: replaceProvider(providers, updated) }));
  },

  deleteProvider: async (id) => {
    await repository().delete("providers", id);
    if (isNativeDesktopRuntime()) {
      await getRuntime().storage?.keychainDelete(providerSecretKey(id));
    }
    let providers = get().providers.filter((provider) => provider.id !== id);
    if (providers.length > 0 && !providers.some((provider) => provider.isDefault)) {
      const [first] = providers;
      if (first) {
        const nextDefault = { ...first, isDefault: true, updatedAt: Date.now() };
        providers = replaceProvider(providers, nextDefault);
        await persistProvider(nextDefault);
      }
    }
    await syncSharedProfiles(providers, [id]);
    set({ providers });
  },

  setDefaultProvider: async (id) => {
    if (!get().providers.some((provider) => provider.id === id)) {
      throw new Error("Provider not found");
    }
    const now = Date.now();
    const providers = get().providers.map((provider) => ({
      ...provider,
      isDefault: provider.id === id,
      updatedAt: provider.id === id ? now : provider.updatedAt,
    }));
    await Promise.all(providers.map(persistProvider));
    await syncSharedProfiles(providers);
    set({ providers });
  },

  switchProvider: async (providerId) => {
    if (!get().providers.some((provider) => provider.id === providerId)) {
      throw new Error("Provider not found");
    }
    await get().setDefaultProvider(providerId);
  },

  testConnection: async (input) => {
    const connectionSchema = providerSchema.omit({ name: true });
    const config = connectionSchema.parse(input);
    const adapter = getAdapter(config.protocolId);
    if (!adapter) throw new Error("Provider adapter not found");
    return adapter.testConnection({
      providerId: input.name || "test",
      modelId: config.modelId,
      authConfig: { baseUrl: config.baseUrl, apiKey: config.apiKey },
    });
  },

  fetchModels: async (input) => {
    try {
      const config = providerSchema
        .pick({
          protocolId: true,
          baseUrl: true,
          apiKey: true,
        })
        .parse(input);
      return (
        (await listModelsForProtocol(config.protocolId, {
          providerId: config.protocolId,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
        })) ?? []
      );
    } catch (error) {
      console.error("[evir] fetchModels failed:", error);
      return [];
    }
  },

  getDefaultProvider: () =>
    get().providers.find((provider) => provider.isDefault && provider.enabled),
}));
