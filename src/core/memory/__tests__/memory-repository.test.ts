import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvirDB } from "../../storage/db";
import { IndexedDBAdapter } from "../../storage/indexed-db-adapter";
import { MemoryRepository } from "../memory-repository";

let database: EvirDB;
let storage: IndexedDBAdapter;
let repository: MemoryRepository;

beforeEach(async () => {
  database = new EvirDB(`evir-memory-repository-${crypto.randomUUID()}`);
  storage = new IndexedDBAdapter(database);
  repository = new MemoryRepository(storage);
  await database.open();
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe("MemoryRepository", () => {
  it("creates, updates, and deletes independent memory records", async () => {
    const created = await repository.create({
      type: "long-term",
      scope: "global",
      key: "language",
      content: "Reply in Chinese",
    });

    expect(await repository.list()).toEqual([created]);

    const updated = await repository.update(created.id, {
      content: "Reply in concise Chinese",
      pinned: true,
    });
    expect(updated.revision).toBe(2);
    expect(updated.content).toBe("Reply in concise Chinese");
    expect(updated.pinned).toBe(true);

    await repository.delete(created.id);
    expect(await repository.list()).toEqual([]);
  });

  it("migrates legacy settings arrays once and removes their old keys", async () => {
    await storage.write("settings", "memories:global", {
      name: "memories:global",
      value: [
        {
          id: "legacy-1",
          type: "conversation",
          scope: "global",
          key: "format",
          content: "Use Markdown",
          createdAt: 10,
          updatedAt: 10,
          pinned: true,
        },
      ],
    });

    const memories = await repository.list();

    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      id: "legacy-1",
      type: "long-term",
      scope: "global",
      source: { kind: "manual" },
      enabled: true,
      revision: 1,
    });
    expect(await storage.read("settings", "memories:global")).toBeUndefined();
    expect(await storage.read("memories", "legacy-1")).toBeDefined();
  });

  it("rejects invalid content instead of persisting it", async () => {
    await expect(
      repository.create({
        type: "long-term",
        scope: "global",
        key: "",
        content: "value",
      }),
    ).rejects.toThrow();
    expect(await repository.list()).toEqual([]);
  });

  it("keeps a legacy setting when any entry cannot be migrated", async () => {
    await storage.write("settings", "memories:global", {
      name: "memories:global",
      value: [
        {
          id: "legacy-valid",
          type: "long-term",
          scope: "global",
          key: "valid",
          content: "Keep this memory",
          createdAt: 10,
          updatedAt: 10,
          pinned: false,
        },
        {
          id: "legacy-invalid",
          type: "long-term",
          scope: "global",
          key: "invalid",
          content: "",
          createdAt: 10,
          updatedAt: 10,
          pinned: false,
        },
      ],
    });

    expect(await repository.list()).toHaveLength(1);
    expect(await storage.read("settings", "memories:global")).toBeDefined();
    expect(await storage.read("memories", "legacy-valid")).toBeDefined();
  });

  it("deduplicates memories saved from the same source message", async () => {
    const input = {
      type: "conversation" as const,
      scope: "conversation-1",
      key: "preference",
      content: "Use pnpm",
      source: {
        kind: "manual" as const,
        conversationId: "conversation-1",
        messageIds: ["message-1"],
      },
    };

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(second.id).toBe(first.id);
    expect(await repository.list()).toHaveLength(1);
  });
});
