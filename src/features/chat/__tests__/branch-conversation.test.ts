import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  type AttachmentRecord,
  type ConversationRecord,
  type MessageRecord,
} from "../../../core/storage/db";
import { useProviderStore } from "../../provider/provider-store";
import { useChatStore } from "../chat-store";
import { streamAssistant } from "../chat-stream";

vi.mock("../../../i18n/config", () => ({
  default: { t: (key: string) => key },
}));
vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "web" as const,
    capabilities: new Set(["chat", "attachments"]),
    has: () => true,
    mode: "ask" as const,
  }),
}));
vi.mock("../chat-stream", () => ({
  providerReadinessError: vi.fn(() => undefined),
  stopActiveStream: vi.fn(),
  streamAssistant: vi.fn(),
}));

const conversation: ConversationRecord = {
  id: "conversation-1",
  title: "Test conversation",
  providerId: "provider-1",
  modelId: "test-model",
  createdAt: 1,
  updatedAt: 1,
};

function makeMessage(
  id: string,
  role: MessageRecord["role"],
  content: string,
  createdAt: number,
): MessageRecord {
  return { id, conversationId: conversation.id, role, content, status: "complete", createdAt };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.conversations.put(conversation);
  useProviderStore.setState({ providers: [] });
  useChatStore.setState({
    conversations: [conversation],
    currentConversationId: conversation.id,
    messages: [],
    mode: "ask",
    isStreaming: false,
    streamingContent: "",
    error: null,
    pendingAttachments: [],
  });
  vi.mocked(streamAssistant).mockResolvedValue({
    content: "Response",
    status: "complete",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("branchConversation", () => {
  it("creates a new conversation with correct fields", async () => {
    const messages = [
      makeMessage("msg-1", "user", "Hello", 1),
      makeMessage("msg-2", "assistant", "Hi there", 2),
      makeMessage("msg-3", "user", "Branch here", 3),
    ];
    await db.messages.bulkPut(messages);
    useChatStore.setState({ messages });

    const newId = await useChatStore.getState().branchConversation("msg-2");

    const branched = await db.conversations.get(newId);
    expect(branched).toBeTruthy();
    expect(branched!.title).toBe("Test conversation (branch)");
    expect(branched!.providerId).toBe(conversation.providerId);
    expect(branched!.modelId).toBe(conversation.modelId);
    expect(branched!.parentConversationId).toBe(conversation.id);
    expect(branched!.branchedFromMessageId).toBe("msg-2");
    expect(branched!.id).not.toBe(conversation.id);
  });

  it("copies messages up to and including the selected message", async () => {
    const messages = [
      makeMessage("msg-1", "user", "Hello", 1),
      makeMessage("msg-2", "assistant", "Hi", 2),
      makeMessage("msg-3", "user", "More", 3),
      makeMessage("msg-4", "assistant", "Even more", 4),
    ];
    await db.messages.bulkPut(messages);
    useChatStore.setState({ messages });

    const newId = await useChatStore.getState().branchConversation("msg-3");

    const branchedMessages = await db.messages
      .where("conversationId")
      .equals(newId)
      .sortBy("createdAt");
    expect(branchedMessages.map((m) => m.content)).toEqual(["Hello", "Hi", "More"]);
    expect(branchedMessages.every((m) => m.id !== "msg-1")).toBe(true);
  });

  it("copies attachments with new IDs", async () => {
    const messages = [
      makeMessage("msg-1", "user", "With attachment", 1),
      makeMessage("msg-2", "assistant", "Response", 2),
    ];
    const attachment: AttachmentRecord = {
      id: "att-1",
      messageId: "msg-1",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      data: "hello",
      type: "text",
      createdAt: 1,
    };
    await db.messages.bulkPut(messages);
    await db.attachments.put(attachment);
    useChatStore.setState({ messages });

    const newId = await useChatStore.getState().branchConversation("msg-2");

    const branchedMessages = await db.messages.where("conversationId").equals(newId).toArray();
    const copiedMsg = branchedMessages.find((m) => m.content === "With attachment");
    expect(copiedMsg).toBeTruthy();
    const copiedAtts = await db.attachments.where("messageId").equals(copiedMsg!.id).toArray();
    expect(copiedAtts.length).toBe(1);
    expect(copiedAtts[0]!.id).not.toBe(attachment.id);
    expect(copiedAtts[0]!.fileName).toBe(attachment.fileName);
    expect(copiedAtts[0]!.data).toBe(attachment.data);
  });

  it("does not modify the original conversation", async () => {
    const messages = [
      makeMessage("msg-1", "user", "Original", 1),
      makeMessage("msg-2", "assistant", "Reply", 2),
    ];
    await db.messages.bulkPut(messages);
    useChatStore.setState({ messages });

    await useChatStore.getState().branchConversation("msg-2");

    const originalMessages = await db.messages
      .where("conversationId")
      .equals(conversation.id)
      .sortBy("createdAt");
    expect(originalMessages.map((m) => m.content)).toEqual(["Original", "Reply"]);
    expect(originalMessages.every((m) => m.id.startsWith("msg-"))).toBe(true);
  });

  it("sets parentConversationId and branchedFromMessageId on branch", async () => {
    const messages = [
      makeMessage("msg-1", "user", "First", 1),
      makeMessage("msg-2", "assistant", "Second", 2),
    ];
    await db.messages.bulkPut(messages);
    useChatStore.setState({ messages });

    const newId = await useChatStore.getState().branchConversation("msg-1");

    const branched = await db.conversations.get(newId);
    expect(branched!.parentConversationId).toBe(conversation.id);
    expect(branched!.branchedFromMessageId).toBe("msg-1");
  });

  it("sets the new conversation as current", async () => {
    const messages = [
      makeMessage("msg-1", "user", "Hi", 1),
      makeMessage("msg-2", "assistant", "Hello", 2),
    ];
    await db.messages.bulkPut(messages);
    useChatStore.setState({ messages });

    const newId = await useChatStore.getState().branchConversation("msg-1");

    expect(useChatStore.getState().currentConversationId).toBe(newId);
  });

  it("throws when message is not found", async () => {
    const messages = [makeMessage("msg-1", "user", "Hi", 1)];
    await db.messages.bulkPut(messages);
    useChatStore.setState({ messages });

    await expect(useChatStore.getState().branchConversation("nonexistent")).rejects.toThrow(
      "Message not found",
    );
  });

  it("throws when no active conversation", async () => {
    useChatStore.setState({ currentConversationId: null });

    await expect(useChatStore.getState().branchConversation("any-id")).rejects.toThrow(
      "No active conversation",
    );
  });
});
