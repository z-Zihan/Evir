import type { StoreApi } from "zustand";
import { db, type ConversationRecord } from "../../core/storage/db";
import type { ChatState } from "./chat-store";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export async function loadConversations(set: ChatStoreSet): Promise<void> {
  set({ conversations: await db.conversations.orderBy("updatedAt").reverse().toArray() });
}

export async function createConversation(
  set: ChatStoreSet,
  providerId: string,
  modelId: string,
): Promise<string> {
  const now = Date.now();
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    title: "",
    providerId,
    modelId,
    createdAt: now,
    updatedAt: now,
  };
  await db.conversations.add(conversation);
  set(({ conversations }) => ({
    conversations: [conversation, ...conversations],
    currentConversationId: conversation.id,
    messages: [],
    error: null,
  }));
  return conversation.id;
}

export async function createOrReuseConversation(
  set: ChatStoreSet,
  get: ChatStoreGet,
  providerId: string,
  modelId: string,
): Promise<string> {
  const { currentConversationId, messages } = get();
  if (currentConversationId && messages.length === 0) return currentConversationId;
  return createConversation(set, providerId, modelId);
}

export async function selectConversation(set: ChatStoreSet, id: string): Promise<void> {
  const messages = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
  set({
    currentConversationId: id,
    messages,
    streamingContent: "",
    error: null,
    pendingAttachments: [],
    pendingToolApproval: null,
  });
}

export async function deleteConversation(set: ChatStoreSet, id: string): Promise<void> {
  await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
    const messageIds = await db.messages.where("conversationId").equals(id).primaryKeys();
    await db.attachments.where("messageId").anyOf(messageIds).delete();
    await db.messages.where("conversationId").equals(id).delete();
    await db.conversations.delete(id);
  });
  set(({ conversations, currentConversationId }) => ({
    conversations: conversations.filter((c) => c.id !== id),
    ...(currentConversationId === id
      ? {
          currentConversationId: null,
          messages: [],
          streamingContent: "",
          pendingAttachments: [],
          pendingToolApproval: null,
        }
      : {}),
  }));
}

export async function renameConversation(
  set: ChatStoreSet,
  id: string,
  title: string,
): Promise<void> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;
  await db.conversations.update(id, { title: cleanTitle, updatedAt: Date.now() });
  set(({ conversations }) => ({
    conversations: conversations.map((c) => (c.id === id ? { ...c, title: cleanTitle } : c)),
  }));
}

export async function togglePin(set: ChatStoreSet, get: ChatStoreGet, id: string): Promise<void> {
  const conv = get().conversations.find((c) => c.id === id);
  const newPinned = conv?.pinned ? 0 : 1;
  try {
    await db.conversations.update(id, { pinned: newPinned, updatedAt: Date.now() });
    set(({ conversations }) => ({
      conversations: conversations.map((c) => (c.id === id ? { ...c, pinned: newPinned } : c)),
    }));
  } catch {
    set({ error: "chat.pinFailed" });
  }
}

export async function updateConversationProvider(
  set: ChatStoreSet,
  get: ChatStoreGet,
  providerId: string,
  modelId: string,
): Promise<void> {
  const { currentConversationId } = get();
  if (!currentConversationId) return;
  const now = Date.now();
  await db.conversations.update(currentConversationId, { providerId, modelId, updatedAt: now });
  set(({ conversations }) => ({
    conversations: conversations.map((c) =>
      c.id === currentConversationId ? { ...c, providerId, modelId, updatedAt: now } : c,
    ),
  }));
}
