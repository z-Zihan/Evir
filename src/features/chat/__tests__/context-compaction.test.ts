// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentRecord, MessageRecord, ProviderRecord } from "../../../core/storage/db";

type StorageOp = { type: "write" | "delete"; entity: string; id: string; data?: unknown };

const { streamAssistantMock, storageState } = vi.hoisted(() => ({
  streamAssistantMock: vi.fn(),
  storageState: {
    entities: new Map<string, Map<string, unknown>>(),
    ops: [] as StorageOp[],
  },
}));

vi.mock("../chat-stream", () => ({
  streamAssistant: streamAssistantMock,
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

import { summarizeAndPersist } from "../context-compaction";

const provider: ProviderRecord = {
  id: "provider-1",
  name: "Provider",
  protocolId: "openai-chat-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "test-key",
  modelId: "model-1",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

const CONVERSATION_ID = "c1";
// With the "<index>:" prefix each message is ~399 characters ≈ 100 estimated tokens.
const BIG_CONTENT = "x".repeat(396);

function makeMsg(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: `m-${Math.random()}`,
    conversationId: CONVERSATION_ID,
    role: "user",
    content: "Hello",
    status: "complete",
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeHistory(count: number, content = BIG_CONTENT): MessageRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeMsg({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${i}:${content}`,
      createdAt: i + 1,
    }),
  );
}

function makeAttachment(id: string, messageId: string): AttachmentRecord {
  return {
    id,
    messageId,
    fileName: `${id}.txt`,
    mimeType: "text/plain",
    size: 4,
    data: "data",
    type: "text",
    createdAt: 1,
  };
}

function opsFor(type: StorageOp["type"], entity: string): StorageOp[] {
  return storageState.ops.filter((op) => op.type === type && op.entity === entity);
}

/** The conversation text the summarizer sent to the model on a given call. */
function summarizedText(callIndex: number): string {
  const messages = streamAssistantMock.mock.calls[callIndex]?.[2] as
    Array<{ role: string; content: string }> | undefined;
  return messages?.[1]?.content ?? "";
}

beforeEach(() => {
  storageState.entities.clear();
  storageState.ops.length = 0;
  streamAssistantMock.mockReset();
  streamAssistantMock.mockResolvedValue({
    content: "Summary of earlier turns",
    status: "complete",
    toolCalls: [],
  });
});

describe("summarizeAndPersist", () => {
  it("replaces the oldest messages with a single summary in one round", async () => {
    // 10 × ~100 tokens; budget 1000 × 0.4 keeps the last 4 and summarizes 6.
    const history = makeHistory(10);

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 1000);

    expect(streamAssistantMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(5);
    const [summary, ...kept] = result;
    expect(summary?.role).toBe("system");
    expect(summary?.content.startsWith("[Previous conversation summary]")).toBe(true);
    expect(summary?.content).toContain("Summary of earlier turns");
    expect(summary?.summaryMetadata?.archiveId).toBe(`summary-source:${summary?.id}`);
    expect(summary?.summaryMetadata?.sourceMessageIds).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
    ]);
    expect(kept).toEqual(history.slice(6));
  });

  it("writes an archive artifact and deletes summarized messages and their attachments", async () => {
    const history = makeHistory(10);
    entityMap("attachments").set("a-old", makeAttachment("a-old", "m1"));
    entityMap("attachments").set("a-kept", makeAttachment("a-kept", "m8"));

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 1000);
    const summary = result[0]!;
    const archiveId = summary.summaryMetadata!.archiveId;

    const artifactWrites = opsFor("write", "artifacts");
    expect(artifactWrites).toHaveLength(1);
    expect(artifactWrites[0]?.id).toBe(archiveId);
    const archive = artifactWrites[0]?.data as {
      type: string;
      relatedEntityId: string;
      messages: MessageRecord[];
      attachments: AttachmentRecord[];
    };
    expect(archive.type).toBe("conversation-summary-source");
    expect(archive.relatedEntityId).toBe(CONVERSATION_ID);
    expect(archive.messages.map(({ id }) => id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    expect(archive.attachments.map(({ id }) => id)).toEqual(["a-old"]);

    expect(opsFor("delete", "attachments").map(({ id }) => id)).toEqual(["a-old"]);
    expect(entityMap("attachments").has("a-kept")).toBe(true);
    expect(opsFor("delete", "messages").map(({ id }) => id)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
    ]);
    const messageWrites = opsFor("write", "messages");
    expect(messageWrites).toHaveLength(1);
    expect(messageWrites[0]?.id).toBe(summary.id);
    expect(messageWrites[0]?.data).toEqual(summary);
  });

  it("re-expands a prior summary's archived sources before summarizing again", async () => {
    const archivedSources = [
      makeMsg({ id: "old-1", content: "original constraint one", createdAt: 1 }),
      makeMsg({ id: "old-2", content: "original constraint two", createdAt: 2 }),
    ];
    entityMap("artifacts").set("summary-source:prior", { messages: archivedSources });
    const priorSummary = makeMsg({
      id: "prior",
      role: "system",
      content: "[Previous conversation summary]\nprior",
      createdAt: 3,
      summaryMetadata: {
        version: 1,
        sourceMessageIds: ["old-1", "old-2"],
        sourceStartedAt: 1,
        sourceEndedAt: 2,
        archiveId: "summary-source:prior",
      },
    });
    const history = [priorSummary, ...makeHistory(9)];

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 1000);

    expect(streamAssistantMock).toHaveBeenCalledTimes(1);
    expect(summarizedText(0)).toContain("original constraint one");
    expect(summarizedText(0)).not.toContain("prior");
    const sourceIds = result[0]?.summaryMetadata?.sourceMessageIds;
    expect(sourceIds?.slice(0, 2)).toEqual(["old-1", "old-2"]);
    expect(sourceIds).not.toContain("prior");
    const archive = opsFor("write", "artifacts")[0]?.data as { messages: MessageRecord[] };
    expect(archive.messages.slice(0, 2)).toEqual(archivedSources);
    // The prior summary message itself (not its archived sources) is what gets deleted.
    expect(opsFor("delete", "messages").map(({ id }) => id)).toContain("prior");
  });

  it("falls back to the summary message itself when its archive is missing", async () => {
    const orphanSummary = makeMsg({
      id: "orphan",
      role: "system",
      content: "[Previous conversation summary]\norphan recap",
      createdAt: 0,
      summaryMetadata: {
        version: 1,
        sourceMessageIds: ["gone"],
        sourceStartedAt: 0,
        sourceEndedAt: 0,
        archiveId: "summary-source:missing",
      },
    });
    const history = [orphanSummary, ...makeHistory(9)];

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 1000);

    expect(streamAssistantMock).toHaveBeenCalledTimes(1);
    expect(summarizedText(0)).toContain("orphan recap");
    expect(result[0]?.summaryMetadata?.sourceMessageIds[0]).toBe("orphan");
  });

  it("returns the original history and persists nothing when summarization fails", async () => {
    streamAssistantMock.mockRejectedValue(new Error("provider down"));
    const history = makeHistory(10);

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 1000);

    expect(streamAssistantMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(history);
    expect(result).toHaveLength(10);
    expect(storageState.ops).toEqual([]);
  });

  it("does not call the model for histories of six messages or fewer", async () => {
    const history = makeHistory(6);

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 10);

    expect(result).toBe(history);
    expect(streamAssistantMock).not.toHaveBeenCalled();
    expect(storageState.ops).toEqual([]);
  });

  it("does not call the model when fewer than three messages fall outside the budget", async () => {
    const history = makeHistory(8, "tiny");

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 100_000);

    expect(result).toBe(history);
    expect(streamAssistantMock).not.toHaveBeenCalled();
    expect(storageState.ops).toEqual([]);
  });

  it("runs a second round with a halved keep ratio while history stays large", async () => {
    // Round 1: budget 2000 × 0.4 = 800 keeps 8, summarizes 12 → 9 messages remain.
    // Round 2: budget 2000 × 0.2 = 400 keeps 4, summarizes the round-1 summary + 4.
    const history = makeHistory(20);

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 2000);

    expect(streamAssistantMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(5);
    expect(result.slice(1)).toEqual(history.slice(16));

    const summaryWrites = opsFor("write", "messages");
    expect(summaryWrites).toHaveLength(2);
    const firstSummary = summaryWrites[0]?.data as MessageRecord;
    expect(firstSummary.summaryMetadata?.sourceMessageIds).toHaveLength(12);
    // Round 2 re-expands the round-1 archive, so the final summary covers m0..m15.
    expect(result[0]?.summaryMetadata?.sourceMessageIds).toEqual(
      history.slice(0, 16).map(({ id }) => id),
    );
    expect(opsFor("delete", "messages").map(({ id }) => id)).toContain(firstSummary.id);
    expect(estimateLength(result)).toBeLessThan(estimateLength(history));
  });

  it("stops after the maximum number of rounds even if still over budget", async () => {
    // Round 1 keeps 12 (budget 1200), round 2 keeps 6 (budget 600) → 7 messages,
    // which a third round (budget 300) would still split, but two rounds is the cap.
    const history = makeHistory(20);

    const result = await summarizeAndPersist(provider, CONVERSATION_ID, history, 3000);

    expect(streamAssistantMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(7);
    expect(result.slice(1)).toEqual(history.slice(14));
  });

  it("archives and deletes an attachment that belongs to a summarized message", async () => {
    const history = makeHistory(10);
    const attachment = makeAttachment("img-1", "m0");
    entityMap("attachments").set(attachment.id, attachment);

    await summarizeAndPersist(provider, CONVERSATION_ID, history, 1000);

    const archive = opsFor("write", "artifacts")[0]?.data as { attachments: AttachmentRecord[] };
    expect(archive.attachments).toEqual([attachment]);
    expect(opsFor("delete", "attachments")).toEqual([
      { type: "delete", entity: "attachments", id: "img-1" },
    ]);
    expect(entityMap("attachments").size).toBe(0);
    expect(entityMap("artifacts").size).toBe(1);
  });
});

function estimateLength(messages: MessageRecord[]): number {
  return messages.reduce((total, { content }) => total + content.length, 0);
}
