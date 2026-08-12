import type { SettingRecord } from "../storage/db";
import type { StoragePort } from "../storage/storage-port";
import {
  memoryRecordSchema,
  parseMemoryRecord,
  type CreateMemoryInput,
  type MemoryRecord,
  type UpdateMemoryInput,
} from "./types";

const LEGACY_MEMORY_PREFIX = "memories:";
const migratedStorages = new WeakSet<object>();

function normalizeLegacyMemory(value: unknown, fallbackScope: string): MemoryRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const scope =
    typeof candidate.scope === "string" && candidate.scope ? candidate.scope : fallbackScope;
  const key = typeof candidate.key === "string" ? candidate.key.trim().slice(0, 80) : "";
  const content =
    typeof candidate.content === "string" ? candidate.content.trim().slice(0, 4_000) : "";
  if (!key || !content) return null;
  const normalized = {
    ...candidate,
    scope,
    key,
    content,
    type: scope === "global" ? "long-term" : candidate.type,
    source: candidate.source ?? { kind: "manual", messageIds: [] },
    confidence: candidate.confidence ?? 1,
    sensitivity: candidate.sensitivity ?? "standard",
    enabled: candidate.enabled ?? true,
    revision: candidate.revision ?? 1,
  };
  return parseMemoryRecord(normalized);
}

export async function migrateLegacyMemories(storage: StoragePort): Promise<number> {
  if (migratedStorages.has(storage)) return 0;
  const settings = await storage.readAll<SettingRecord>("settings");
  const legacySettings = settings.filter(({ name }) => name.startsWith(LEGACY_MEMORY_PREFIX));
  const existingIds = new Set(
    (await storage.readAll<unknown>("memories"))
      .map(parseMemoryRecord)
      .filter((memory): memory is MemoryRecord => memory !== null)
      .map(({ id }) => id),
  );
  const migrated: MemoryRecord[] = [];
  const migratedSettingNames: string[] = [];

  for (const setting of legacySettings) {
    const fallbackScope = setting.name.slice(LEGACY_MEMORY_PREFIX.length) || "global";
    if (!Array.isArray(setting.value)) continue;
    let fullyMigrated = true;
    for (const value of setting.value) {
      const memory = normalizeLegacyMemory(value, fallbackScope);
      if (!memory) {
        fullyMigrated = false;
      } else if (!existingIds.has(memory.id)) {
        migrated.push(memory);
        existingIds.add(memory.id);
      }
    }
    if (fullyMigrated) migratedSettingNames.push(setting.name);
  }

  if (migrated.length > 0 || migratedSettingNames.length > 0) {
    await storage.apply([
      ...migrated.map((memory) => ({
        type: "write" as const,
        entity: "memories" as const,
        id: memory.id,
        data: memory,
      })),
      ...migratedSettingNames.map((name) => ({
        type: "delete" as const,
        entity: "settings" as const,
        id: name,
      })),
    ]);
  }
  migratedStorages.add(storage);
  return migrated.length;
}

export class MemoryRepository {
  constructor(private readonly storage: StoragePort) {}

  async list(): Promise<MemoryRecord[]> {
    await migrateLegacyMemories(this.storage);
    return (await this.storage.readAll<unknown>("memories"))
      .map(parseMemoryRecord)
      .filter((memory): memory is MemoryRecord => memory !== null)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }

  async listForScopes(scopes: ReadonlySet<string>): Promise<MemoryRecord[]> {
    return (await this.list()).filter(({ scope }) => scopes.has(scope));
  }

  async create(input: CreateMemoryInput): Promise<MemoryRecord> {
    await migrateLegacyMemories(this.storage);
    if (input.source?.messageIds.length) {
      const existing = (await this.list()).find(
        (memory) =>
          memory.scope === input.scope &&
          memory.source.messageIds.some((id) => input.source?.messageIds.includes(id)),
      );
      if (existing) return existing;
    }
    const now = Date.now();
    const memory = memoryRecordSchema.parse({
      ...input,
      id: `mem-${crypto.randomUUID()}`,
      source: input.source ?? { kind: "manual", messageIds: [] },
      confidence: input.confidence ?? 1,
      sensitivity: input.sensitivity ?? "standard",
      enabled: true,
      pinned: input.pinned ?? false,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await this.storage.write("memories", memory.id, memory);
    return memory;
  }

  async update(id: string, input: UpdateMemoryInput): Promise<MemoryRecord> {
    const existing = parseMemoryRecord(await this.storage.read<unknown>("memories", id));
    if (!existing) throw new Error(`Memory not found: ${id}`);
    const memory = memoryRecordSchema.parse({
      ...existing,
      ...input,
      ...(input.expiresAt === null ? { expiresAt: undefined } : {}),
      id: existing.id,
      scope: existing.scope,
      type: existing.type,
      source: existing.source,
      revision: existing.revision + 1,
      updatedAt: Date.now(),
    });
    await this.storage.write("memories", id, memory);
    return memory;
  }

  async delete(id: string): Promise<void> {
    await this.storage.delete("memories", id);
  }

  async clear(): Promise<void> {
    await this.storage.clear("memories");
  }

  async markUsed(memories: MemoryRecord[], usedAt: number): Promise<void> {
    if (memories.length === 0) return;
    await this.storage.apply(
      memories.map((memory) => ({
        type: "write" as const,
        entity: "memories" as const,
        id: memory.id,
        data: { ...memory, lastUsedAt: usedAt },
      })),
    );
  }
}
