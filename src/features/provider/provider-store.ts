import { create } from "zustand";
import { z } from "zod";
import { getAdapter } from "../../core/providers/adapter-registry";
import type { ProviderError } from "../../core/providers/stream-events";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import { db, type ProviderRecord } from "../../core/storage/db";

export const providerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  protocolId: z.enum(["openai-chat-completions", "openai-compatible-chat", "anthropic-messages"]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().trim().min(1),
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
  testConnection: (config: ProviderConfigInput) => Promise<ConnectionResult>;
  getDefaultProvider: () => ProviderRecord | undefined;
}

async function shouldPersistApiKeys(): Promise<boolean> {
  return (await db.settings.get("persistApiKeys"))?.value === true;
}

async function persistProvider(provider: ProviderRecord): Promise<void> {
  const persistApiKey = await shouldPersistApiKeys();
  await db.providers.put({ ...provider, apiKey: persistApiKey ? provider.apiKey : "" });
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
    const providers = await db.providers.toArray();
    set({ providers: providers.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  addProvider: async (input) => {
    const config = providerSchema.parse(input);
    const now = Date.now();
    const provider: ProviderRecord = {
      id: crypto.randomUUID(),
      ...config,
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
    const { apiKey = current.apiKey, ...config } = updateSchema.parse({ ...current, ...patch });
    const updated: ProviderRecord = {
      ...current,
      ...config,
      apiKey,
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      updatedAt: Date.now(),
    };
    await persistProvider(updated);
    set(({ providers }) => ({ providers: replaceProvider(providers, updated) }));
  },

  deleteProvider: async (id) => {
    await db.providers.delete(id);
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
    const persistApiKey = await shouldPersistApiKeys();
    await db.providers.bulkPut(
      providers.map((provider) => ({
        ...provider,
        apiKey: persistApiKey ? provider.apiKey : "",
      })),
    );
    set({ providers });
  },

  testConnection: async (input) => {
    const config = providerSchema.parse(input);
    const adapter = getAdapter(config.protocolId);
    if (!adapter) throw new Error("Provider adapter not found");
    return adapter.testConnection({
      providerId: config.name,
      modelId: config.modelId,
      authConfig: { baseUrl: config.baseUrl, apiKey: config.apiKey },
    });
  },

  getDefaultProvider: () =>
    get().providers.find((provider) => provider.isDefault && provider.enabled),
}));
