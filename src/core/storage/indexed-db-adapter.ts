import type { Table } from "dexie";
import { db, type EvirDB } from "./db";
import type { EntityName, StoragePort } from "./storage-port";

type StoredRecord = Record<string, unknown>;

const SUPPORTED_ENTITIES = [
  "providers",
  "conversations",
  "messages",
  "usage_records",
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
    await this.table(entity).put({ ...data, id });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.table(entity).delete(id);
  }

  async query<T>(entity: EntityName, filter: Partial<T>): Promise<T[]> {
    if (!isStoredRecord(filter)) return [];
    const entries = Object.entries(filter);
    const records = await this.table(entity).toArray();
    return records.filter((record) =>
      entries.every(([key, value]) => record[key] === value),
    ) as T[];
  }

  private table(entity: EntityName): Table<StoredRecord, string> {
    if (!isSupportedEntity(entity)) {
      throw new Error(`IndexedDB storage does not support entity: ${entity}`);
    }
    return this.database.table<StoredRecord, string>(entity);
  }
}
