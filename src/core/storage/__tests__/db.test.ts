import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvirDB, type ConversationRecord, type MessageRecord, type ProviderRecord } from "../db";
import { IndexedDBAdapter } from "../indexed-db-adapter";

let database: EvirDB;
let storage: IndexedDBAdapter;

beforeEach(async () => {
  database = new EvirDB(`evir-test-${crypto.randomUUID()}`);
  storage = new IndexedDBAdapter(database);
  await database.open();
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe("IndexedDBAdapter", () => {
  it("adds, gets, queries, and deletes a provider", async () => {
    const provider: ProviderRecord = {
      id: "provider-1",
      name: "OpenAI",
      protocolId: "openai-chat-completions",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      modelId: "gpt-test",
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };

    await storage.write("providers", provider.id, provider);
    expect(await storage.read<ProviderRecord>("providers", provider.id)).toEqual(provider);
    expect(await storage.query<ProviderRecord>("providers", { isDefault: true })).toEqual([
      provider,
    ]);
    await storage.delete("providers", provider.id);
    expect(await storage.read("providers", provider.id)).toBeUndefined();
  });

  it("adds, gets, and deletes a conversation", async () => {
    const conversation: ConversationRecord = {
      id: "conversation-1",
      title: "Test",
      providerId: "provider-1",
      modelId: "gpt-test",
      createdAt: 1,
      updatedAt: 1,
    };

    await storage.write("conversations", conversation.id, conversation);
    expect(await storage.readAll<ConversationRecord>("conversations")).toEqual([conversation]);
    await storage.delete("conversations", conversation.id);
    expect(await storage.readAll("conversations")).toEqual([]);
  });

  it("adds and gets messages by conversation", async () => {
    const message: MessageRecord = {
      id: "message-1",
      conversationId: "conversation-1",
      role: "user",
      content: "Hello",
      status: "complete",
      createdAt: 1,
    };

    await storage.write("messages", message.id, message);
    expect(
      await storage.query<MessageRecord>("messages", { conversationId: "conversation-1" }),
    ).toEqual([message]);
  });

  it("stores memories as independent structured records", async () => {
    const memory = {
      id: "memory-1",
      type: "long-term",
      scope: "global",
      key: "language",
      content: "Reply in Chinese",
      source: { kind: "manual", messageIds: [] },
      confidence: 1,
      sensitivity: "standard",
      enabled: true,
      pinned: false,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    await storage.write("memories", memory.id, memory);

    expect(await storage.query("memories", { scope: "global" })).toEqual([memory]);
  });
});
