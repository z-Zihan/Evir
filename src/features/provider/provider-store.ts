import { create } from "zustand";
import { z } from "zod";
import { getAdapter, listModelsForProtocol } from "../../core/providers/adapter-registry";
import type { ProviderError } from "../../core/providers/stream-events";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import type { ProviderRecord, SettingRecord } from "../../core/storage/db";
import type { StoragePort } from "../../core/storage/storage-port";
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
    const providers = await Promise.all(
      (await repository().readAll<ProviderRecord>("providers")).map(hydrateProviderSecret),
    );
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
