import { db, EvirDB, type ProviderRecord, type SettingRecord } from "../core/storage/db";
import type { EntityName, StoragePort } from "../core/storage/storage-port";
import { getRuntime, isNativeDesktopRuntime } from "./use-runtime";

const BASE_MIGRATION_MARKER = "desktopStructuredStorageMigrationV1";
const MEMORY_MIGRATION_MARKER = "desktopStructuredStorageMigrationV2";

/**
 * Web legacy migration (§55): profile-scoped Dexie names (`evir:<id>`) replaced
 * the shared "evir" database. On the default profile's first boot under the
 * new scheme, copy every legacy table into the profile namespace (only into
 * empty tables — idempotent, never destructive; the legacy DB stays on disk).
 */
async function migrateLegacyWebDatabase(): Promise<void> {
  if (isNativeDesktopRuntime()) return;
  const marker = await db.settings.get("webLegacyProfileMigrationV1");
  if (marker?.value === true) return;
  let legacy: EvirDB | null = null;
  try {
    legacy = new EvirDB("evir");
    await legacy.open();
    // Structural types keep the heterogeneous Dexie tables callable.
    interface CopyableTable {
      toArray(): Promise<unknown[]>;
      count(): Promise<number>;
      bulkPut(rows: unknown[]): Promise<unknown>;
    }
    const asCopyable = (table: unknown): CopyableTable => table as CopyableTable;
    const pairs: Array<[source: CopyableTable, target: CopyableTable]> = [
      [asCopyable(legacy.providers), asCopyable(db.providers)],
      [asCopyable(legacy.conversations), asCopyable(db.conversations)],
      [asCopyable(legacy.messages), asCopyable(db.messages)],
      [asCopyable(legacy.attachments), asCopyable(db.attachments)],
      [asCopyable(legacy.usage_records), asCopyable(db.usage_records)],
      [asCopyable(legacy.mcpServers), asCopyable(db.mcpServers)],
      [asCopyable(legacy.settings), asCopyable(db.settings)],
      [asCopyable(legacy.agentRuns), asCopyable(db.agentRuns)],
      [asCopyable(legacy.taskBriefs), asCopyable(db.taskBriefs)],
      [asCopyable(legacy.plans), asCopyable(db.plans)],
      [asCopyable(legacy.runSteps), asCopyable(db.runSteps)],
      [asCopyable(legacy.runEvents), asCopyable(db.runEvents)],
      [asCopyable(legacy.agentAssignments), asCopyable(db.agentAssignments)],
      [asCopyable(legacy.approvals), asCopyable(db.approvals)],
      [asCopyable(legacy.toolExecutions), asCopyable(db.toolExecutions)],
      [asCopyable(legacy.artifacts), asCopyable(db.artifacts)],
      [asCopyable(legacy.memories), asCopyable(db.memories)],
      [asCopyable(legacy.projects), asCopyable(db.projects)],
    ];
    for (const [source, target] of pairs) {
      const rows = await source.toArray();
      if (rows.length === 0 || (await target.count()) > 0) continue;
      await target.bulkPut(rows);
    }
  } catch {
    // Legacy database absent/unreadable: nothing to migrate.
  } finally {
    legacy?.close();
  }
  await db.settings.put({
    name: "webLegacyProfileMigrationV1",
    value: true,
  } satisfies SettingRecord);
}

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

/**
 * Desktop legacy path: webview Dexie → per-profile SQLite, guarded by markers
 * inside the profile database itself (so a fresh second profile never imports
 * another user's Dexie leftovers — the Dexie namespace is also per-profile).
 */
async function initializeDesktopStructuredStorage(): Promise<void> {
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

export async function initializeRuntimeStorage(): Promise<void> {
  await migrateLegacyWebDatabase();
  if (isNativeDesktopRuntime()) {
    await initializeDesktopStructuredStorage();
  }
}
