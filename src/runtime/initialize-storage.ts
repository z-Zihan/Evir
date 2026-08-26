import { db, type ProviderRecord, type SettingRecord } from "../core/storage/db";
import type { EntityName, StoragePort } from "../core/storage/storage-port";
import { getRuntime, isNativeDesktopRuntime } from "./use-runtime";

const BASE_MIGRATION_MARKER = "desktopStructuredStorageMigrationV1";
const MEMORY_MIGRATION_MARKER = "desktopStructuredStorageMigrationV2";

async function migrateEntity<T>(
  storage: StoragePort,
  entity: EntityName,
  records: T[],
): Promise<void> {
  if (records.length === 0 || (await storage.readAll<T>(entity)).length > 0) return;
  await storage.writeMany(entity, records);
}

async function migrateProviders(storage: StoragePort): Promise<void> {
  const providers = await db.providers.toArray();
  const sanitized: ProviderRecord[] = [];
  for (const provider of providers) {
    if (provider.apiKey) {
      const key = `provider:${provider.id}:api-key`;
      const secureStorage = getRuntime().storage;
      if (!secureStorage) throw new Error("Desktop secure storage is unavailable");
      await secureStorage.keychainSet(key, provider.apiKey);
      const persistedApiKey = await secureStorage.keychainGet(key);
      if (persistedApiKey !== provider.apiKey) {
        throw new Error("Provider credential migration could not be verified in secure storage");
      }
    }
    sanitized.push({ ...provider, apiKey: "" });
  }
  await migrateEntity(storage, "providers", sanitized);
  if (providers.some(({ apiKey }) => apiKey.length > 0)) {
    await db.providers.bulkPut(sanitized);
  }
}

export async function initializeRuntimeStorage(): Promise<void> {
  if (!isNativeDesktopRuntime()) return;
  const storage = getRuntime().structuredStorage;
  if (!storage) throw new Error("Desktop structured storage is unavailable");
  const baseMarker = await storage.read<SettingRecord>("settings", BASE_MIGRATION_MARKER);
  if (baseMarker?.value !== true) {
    await migrateProviders(storage);
    await migrateEntity(storage, "conversations", await db.conversations.toArray());
    await migrateEntity(storage, "messages", await db.messages.toArray());
    await migrateEntity(storage, "attachments", await db.attachments.toArray());
    await migrateEntity(storage, "usage_records", await db.usage_records.toArray());
    await migrateEntity(storage, "mcp_servers", await db.mcpServers.toArray());
    await migrateEntity(storage, "settings", await db.settings.toArray());
    await storage.write<SettingRecord>("settings", BASE_MIGRATION_MARKER, {
      name: BASE_MIGRATION_MARKER,
      value: true,
    });
  }

  const memoryMarker = await storage.read<SettingRecord>("settings", MEMORY_MIGRATION_MARKER);
  if (memoryMarker?.value === true) return;
  await migrateEntity(storage, "memories", await db.memories.toArray());
  await storage.write<SettingRecord>("settings", MEMORY_MIGRATION_MARKER, {
    name: MEMORY_MIGRATION_MARKER,
    value: true,
  });
}
