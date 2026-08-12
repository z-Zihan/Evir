import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../../core/storage/db";
import { useMemoryStore } from "../memory-store";

beforeEach(async () => {
  await Promise.all([db.memories.clear(), db.settings.clear()]);
  useMemoryStore.setState({ memories: [], enabled: true, loading: false, error: null });
});

afterEach(async () => {
  await Promise.all([db.memories.clear(), db.settings.clear()]);
});

describe("memory store", () => {
  it("keeps one in-memory record when a source message is saved again", async () => {
    const input = {
      type: "conversation" as const,
      scope: "conversation-1",
      key: "User preference",
      content: "Keep answers concise",
      source: {
        kind: "manual" as const,
        conversationId: "conversation-1",
        messageIds: ["message-1"],
      },
    };

    const firstId = await useMemoryStore.getState().addMemory(input);
    const secondId = await useMemoryStore.getState().addMemory(input);

    expect(secondId).toBe(firstId);
    expect(useMemoryStore.getState().memories.map(({ id }) => id)).toEqual([firstId]);
    expect(await db.memories.count()).toBe(1);
  });
});
