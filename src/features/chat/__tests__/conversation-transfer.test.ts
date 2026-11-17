import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentRecord, ConversationRecord, MessageRecord } from "../../../core/storage/db";

type StorageOp = { type: "write" | "delete"; entity: string; id: string; data?: unknown };

const { storageState } = vi.hoisted(() => ({
  storageState: {
    entities: new Map<string, Map<string, unknown>>(),
    ops: [] as StorageOp[],
  },
}));

function entityMap(entity: string): Map<string, unknown> {
  let map = storageState.entities.get(entity);
  if (!map) {
    map = new Map();
    storageState.entities.set(entity, map);
  }
  return map;
}

vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: vi.fn(() => ({
    readAll: (entity: string) => Promise.resolve([...entityMap(entity).values()]),
    read: (entity: string, id: string) => Promise.resolve(entityMap(entity).get(id)),
    query: (entity: string, filter: Record<string, unknown>) =>
      Promise.resolve(
        [...entityMap(entity).values()].filter((record) =>
          Object.entries(filter).every(
            ([key, value]) => (record as Record<string, unknown>)[key] === value,
          ),
        ),
      ),
    apply: (ops: StorageOp[]) => {
      for (const op of ops) {
        storageState.ops.push(op);
        if (op.type === "write") entityMap(op.entity).set(op.id, op.data);
        else entityMap(op.entity).delete(op.id);
      }
      return Promise.resolve();
    },
  })),
}));

vi.mock("../../runtime/use-runtime", () => ({
  getRuntime: vi.fn(() => ({ target: "web" })),
}));

import { exportConversation, exportConversations } from "../conversation-export";
import { importConversations } from "../conversation-import";

const CONVERSATION_ID = "c1";
const ARCHIVE_ID = "archive-1";

const conversation: ConversationRecord = {
  id: CONVERSATION_ID,
  title: "Compacted",
  providerId: "provider-1",
  modelId: "model-1",
  createdAt: 1,
  updatedAt: 10,
};

const archivedAttachment: AttachmentRecord = {
  id: "att-archived",
  messageId: "m0",
  fileName: "notes.txt",
  mimeType: "text/plain",
  size: 5,
  data: "aGVsbG8=",
  type: "text",
  createdAt: 1,
};

const sourceMessages: MessageRecord[] = [
  {
    id: "m0",
    conversationId: CONVERSATION_ID,
    role: "user",
    content: "Never touch prod",
    status: "complete",
    createdAt: 1,
  },
  {
    id: "m1",
    conversationId: CONVERSATION_ID,
    role: "assistant",
    content: "Understood",
    status: "complete",
    createdAt: 2,
  },
];

const archive = {
  id: ARCHIVE_ID,
  type: "conversation-summary-source" as const,
  relatedEntityId: CONVERSATION_ID,
  messages: sourceMessages,
  attachments: [archivedAttachment],
  createdAt: 5,
};

const summaryMessage: MessageRecord = {
  id: "summary-1",
  conversationId: CONVERSATION_ID,
  role: "system",
  content: "Summary: user forbids touching prod.",
  status: "complete",
  createdAt: 3,
  summaryMetadata: {
    version: 1,
    sourceMessageIds: ["m0", "m1"],
    sourceStartedAt: 1,
    sourceEndedAt: 2,
    archiveId: ARCHIVE_ID,
  },
};

const latestMessage: MessageRecord = {
  id: "m2",
  conversationId: CONVERSATION_ID,
  role: "user",
  content: "Continue",
  status: "complete",
  createdAt: 4,
};

interface ExportedData {
  conversations: Array<
    ConversationRecord & { messages: Array<MessageRecord & { attachments: AttachmentRecord[] }> }
  >;
  archives?: Array<typeof archive>;
}

function seedCompactedConversation(): void {
  entityMap("conversations").set(conversation.id, conversation);
  entityMap("messages").set(summaryMessage.id, summaryMessage);
  entityMap("messages").set(latestMessage.id, latestMessage);
  entityMap("artifacts").set(ARCHIVE_ID, archive);
}

async function blobToJson(blob: Blob): Promise<ExportedData> {
  return JSON.parse(await blob.text()) as ExportedData;
}

function toFile(content: string): File {
  return new File([content], "export.json", { type: "application/json" });
}

describe("conversation export/import summary archives", () => {
  beforeEach(() => {
    storageState.entities.clear();
    storageState.ops.length = 0;
  });

  it("exports the summary-source archive referenced by compacted messages", async () => {
    seedCompactedConversation();
    entityMap("artifacts").set("tool-out", {
      id: "tool-out",
      type: "tool-output-source",
      relatedEntityId: CONVERSATION_ID,
    });

    for (const blob of [await exportConversations(), await exportConversation(CONVERSATION_ID)]) {
      const data = await blobToJson(blob);
      expect(data.archives).toEqual([archive]);
    }
  });

  it("exports a summary archive shared by branches only once", async () => {
    seedCompactedConversation();
    entityMap("conversations").set("c2", { ...conversation, id: "c2" });
    entityMap("messages").set("summary-2", {
      ...summaryMessage,
      id: "summary-2",
      conversationId: "c2",
    });

    const data = await blobToJson(await exportConversations());

    expect(data.conversations).toHaveLength(2);
    expect(data.archives).toEqual([archive]);
  });

  it("restores the archive on round-trip import", async () => {
    seedCompactedConversation();
    const text = await (await exportConversations()).text();
    const exportedMessages = (JSON.parse(text) as ExportedData).conversations[0]?.messages;
    storageState.entities.clear();

    const result = await importConversations(toFile(text));

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(entityMap("artifacts").get(ARCHIVE_ID)).toEqual(archive);
    const importedMessages = [...entityMap("messages").values()] as MessageRecord[];
    expect(exportedMessages?.map(({ id }) => id)).toEqual([summaryMessage.id, latestMessage.id]);
    expect(importedMessages.sort((a, b) => a.createdAt - b.createdAt)).toEqual([
      summaryMessage,
      latestMessage,
    ]);
    // Messages and the archive land in a single apply batch.
    expect(storageState.ops.map(({ entity }) => entity)).toEqual([
      "conversations",
      "messages",
      "artifacts",
      "messages",
    ]);
  });

  it("does not overwrite an archive that already exists locally", async () => {
    seedCompactedConversation();
    const text = await (await exportConversations()).text();
    storageState.entities.clear();
    const localArchive = { ...archive, messages: [], createdAt: 99 };
    entityMap("artifacts").set(ARCHIVE_ID, localArchive);

    const result = await importConversations(toFile(text));

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(entityMap("artifacts").get(ARCHIVE_ID)).toBe(localArchive);
    expect(storageState.ops.some(({ entity }) => entity === "artifacts")).toBe(false);
  });

  it("imports legacy exports without an archives field", async () => {
    const legacy = {
      version: 1,
      exportedAt: 1,
      conversations: [
        { ...conversation, messages: [{ ...summaryMessage, attachments: [] }, latestMessage] },
      ],
    };

    const result = await importConversations(toFile(JSON.stringify(legacy)));

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(entityMap("messages").get(summaryMessage.id)).toEqual(summaryMessage);
    expect(storageState.ops.some(({ entity }) => entity === "artifacts")).toBe(false);
  });

  it("skips archives missing from storage on export and still imports", async () => {
    seedCompactedConversation();
    entityMap("artifacts").delete(ARCHIVE_ID);

    const text = await (await exportConversations()).text();
    expect((JSON.parse(text) as ExportedData).archives ?? []).toEqual([]);
    storageState.entities.clear();

    const result = await importConversations(toFile(text));

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(entityMap("messages").get(summaryMessage.id)).toEqual(summaryMessage);
    expect(entityMap("artifacts").size).toBe(0);
  });
});
