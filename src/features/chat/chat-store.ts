import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import { db, type ConversationRecord, type MessageRecord } from "../../core/storage/db";
import { stopActiveStream } from "./chat-stream";
import type { InteractionMode } from "../../core/providers/tool-registry";
import {
  processFile,
  validateAttachmentCount,
  type ProcessedAttachment,
  AttachmentError,
} from "./attachment-utils";
import { sendChatMessage } from "./send-message";
import { streamResponse } from "./stream-response";
import { getRuntime } from "../../runtime/use-runtime";
import { branchConversation as doBranchConversation } from "./branch-conversation";
import { approveTool, denyTool, type PendingToolApproval } from "./tool-approval";
export interface ChatState {
  conversations: ConversationRecord[];
  currentConversationId: string | null;
  messages: MessageRecord[];
  mode: InteractionMode;
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  pendingAttachments: ProcessedAttachment[];
  pendingToolApproval: PendingToolApproval | null;
  loadConversations: () => Promise<void>;
  createConversation: (providerId: string, modelId: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  updateConversationProvider: (providerId: string, modelId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  stopGeneration: () => void;
  addAttachment: (file: File) => Promise<void>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setMode: (mode: InteractionMode) => void;
  approveTool: () => Promise<void>;
  denyTool: () => Promise<void>;
  branchConversation: (messageId: string) => Promise<string>;
}
export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  mode: "ask",
  isStreaming: false,
  streamingContent: "",
  error: null,
  pendingAttachments: [],
  pendingToolApproval: null,
  loadConversations: async () => {
    set({ conversations: await db.conversations.orderBy("updatedAt").reverse().toArray() });
  },
  createConversation: async (providerId, modelId) => {
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
  },
  selectConversation: async (id) => {
    const messages = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
    set({
      currentConversationId: id,
      messages,
      streamingContent: "",
      error: null,
      pendingAttachments: [],
      pendingToolApproval: null,
    });
  },
  deleteConversation: async (id) => {
    await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
      const messageIds = await db.messages.where("conversationId").equals(id).primaryKeys();
      await db.attachments.where("messageId").anyOf(messageIds).delete();
      await db.messages.where("conversationId").equals(id).delete();
      await db.conversations.delete(id);
    });
    set(({ conversations, currentConversationId }) => ({
      conversations: conversations.filter((conversation) => conversation.id !== id),
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
  },
  renameConversation: async (id, title) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    await db.conversations.update(id, { title: cleanTitle, updatedAt: Date.now() });
    set(({ conversations }) => ({
      conversations: conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, title: cleanTitle } : conversation,
      ),
    }));
  },
  togglePin: async (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    const newPinned = conv?.pinned ? 0 : 1;
    await db.conversations.update(id, { pinned: newPinned, updatedAt: Date.now() });
    set(({ conversations }) => ({
      conversations: conversations.map((c) => (c.id === id ? { ...c, pinned: newPinned } : c)),
    }));
  },
  updateConversationProvider: async (providerId, modelId) => {
    const { currentConversationId } = get();
    if (!currentConversationId) return;
    const now = Date.now();
    await db.conversations.update(currentConversationId, { providerId, modelId, updatedAt: now });
    set(({ conversations }) => ({
      conversations: conversations.map((c) =>
        c.id === currentConversationId ? { ...c, providerId, modelId, updatedAt: now } : c,
      ),
    }));
  },
  addAttachment: async (file) => {
    const current = get().pendingAttachments;
    if (!validateAttachmentCount(current.length)) {
      set({ error: "chat.attachmentLimit" });
      return;
    }
    try {
      const processed = await processFile(file);
      set({ pendingAttachments: [...current, processed], error: null });
    } catch (error) {
      const message = error instanceof AttachmentError ? error.message : "chat.unsupportedFileType";
      set({ error: message });
    }
  },
  removeAttachment: (id) => {
    set(({ pendingAttachments }) => ({
      pendingAttachments: pendingAttachments.filter((a) => a.id !== id),
    }));
  },
  clearAttachments: () => set({ pendingAttachments: [] }),
  setMode: (mode) => set({ mode }),
  approveTool: async () => {
    const pending = get().pendingToolApproval;
    if (!pending) return;
    await approveTool(pending, set, get);
  },
  denyTool: async () => {
    const pending = get().pendingToolApproval;
    if (!pending) return;
    await denyTool(pending, set, get);
  },
  sendMessage: (text) => sendChatMessage(set, get, text),
  regenerate: async () => {
    const { messages, currentConversationId, isStreaming } = get();
    if (!currentConversationId || isStreaming) return;
    const lastAssistant = [...messages].reverse().find(({ role }) => role === "assistant");
    if (!lastAssistant) return;
    await db.messages.delete(lastAssistant.id);
    const history = messages.filter(({ id }) => id !== lastAssistant.id);
    set({ messages: history, pendingToolApproval: null });
    await streamResponse(set, get, history, currentConversationId, getRuntime());
  },
  editMessage: async (messageId, newContent) => {
    const { messages, currentConversationId, isStreaming } = get();
    if (!currentConversationId || isStreaming) return;
    const index = messages.findIndex(({ id }) => id === messageId);
    const message = messages[index];
    if (!message || message.role !== "user") return;
    const toDelete = messages.slice(index + 1);
    const deleteIds = toDelete.map(({ id }) => id);
    await db.transaction("rw", db.messages, db.attachments, async () => {
      await db.messages.update(messageId, { content: newContent });
      if (deleteIds.length > 0) {
        await db.attachments.where("messageId").anyOf(deleteIds).delete();
        await db.messages.bulkDelete(deleteIds);
      }
    });
    const updated = messages.slice(0, index + 1);
    updated[index] = { ...message, content: newContent };
    set({ messages: updated, pendingToolApproval: null });
    await streamResponse(set, get, updated, currentConversationId, getRuntime());
  },
  stopGeneration: stopActiveStream,
  branchConversation: async (messageId) => {
    const { currentConversationId, messages, conversations, isStreaming } = get();
    if (!currentConversationId || isStreaming) throw new Error("Cannot branch now");
    const conversation = conversations.find((c) => c.id === currentConversationId);
    if (!conversation) throw new Error("Conversation not found");
    const newId = await doBranchConversation(messages, conversation, messageId);
    await get().loadConversations();
    await get().selectConversation(newId);
    return newId;
  },
}));
