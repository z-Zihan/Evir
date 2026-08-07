import type { Table } from "dexie";
import { db, type EvirDB } from "./db";
import type { EntityName, StorageMutation, StoragePort } from "./storage-port";

type StoredRecord = Record<string, unknown>;

const SUPPORTED_ENTITIES = [
  "providers",
  "conversations",
  "messages",
  "attachments",
  "usage_records",
  "mcp_servers",
  "settings",
  "agent_runs",
  "tool_executions",
  "artifacts",
] as const satisfies readonly EntityName[];

type SupportedEntity = (typeof SUPPORTED_ENTITIES)[number];

function isStoredRecord(value: unknown): value is StoredRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedEntity(entity: EntityName): entity is SupportedEntity {
  return SUPPORTED_ENTITIES.includes(entity as SupportedEntity);
}

export class IndexedDBAdapter implements StoragePort {
  constructor(private readonly database: EvirDB = db) {}

  async read<T>(entity: EntityName, id: string): Promise<T | undefined> {
    return (await this.table(entity).get(id)) as T | undefined;
  }

  async readAll<T>(entity: EntityName): Promise<T[]> {
    return (await this.table(entity).toArray()) as T[];
  }

  async write<T>(entity: EntityName, id: string, data: T): Promise<void> {
    if (!isStoredRecord(data)) {
      throw new TypeError(`Storage entity ${entity} must be an object`);
    }
    const key = entity === "settings" ? "name" : "id";
    await this.table(entity).put({ ...data, [key]: id });
  }

  async writeMany<T>(entity: EntityName, data: T[]): Promise<void> {
    if (!data.every(isStoredRecord)) {
      throw new TypeError(`Storage entity ${entity} must contain objects`);
    }
    await this.table(entity).bulkPut(data as StoredRecord[]);
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.table(entity).delete(id);
  }

  async deleteMany(entity: EntityName, ids: string[]): Promise<void> {
    await this.table(entity).bulkDelete(ids);
  }

  async clear(entity: EntityName): Promise<void> {
    await this.table(entity).clear();
  }

  async query<T>(entity: EntityName, filter: Partial<T>): Promise<T[]> {
    if (!isStoredRecord(filter)) return [];
    const entries = Object.entries(filter);
    const records = await this.table(entity).toArray();
    return records.filter((record) =>
      entries.every(([key, value]) => record[key] === value),
    ) as T[];
  }

  async apply(mutations: StorageMutation[]): Promise<void> {
    const tables = [...new Set(mutations.map(({ entity }) => this.table(entity)))];
    await this.database.transaction("rw", tables, async () => {
      for (const mutation of mutations) {
        const table = this.table(mutation.entity);
        if (mutation.type === "clear") await table.clear();
        else if (mutation.type === "delete") await table.delete(mutation.id);
        else {
          const key = mutation.entity === "settings" ? "name" : "id";
          await table.put({ ...mutation.data, [key]: mutation.id });
        }
      }
    });
  }

  private table(entity: EntityName): Table<StoredRecord, string> {
    if (!isSupportedEntity(entity)) {
      throw new Error(`IndexedDB storage does not support entity: ${entity}`);
    }
    const table =
      entity === "mcp_servers"
        ? this.database.mcpServers
        : entity === "agent_runs"
          ? this.database.agentRuns
          : entity === "tool_executions"
            ? this.database.toolExecutions
            : entity === "artifacts"
              ? this.database.artifacts
              : this.database[entity];
    return table as unknown as Table<StoredRecord, string>;
  }
}
