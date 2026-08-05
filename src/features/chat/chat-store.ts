import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import { db, type ConversationRecord, type MessageRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { providerReadinessError, stopActiveStream, streamAssistant } from "./chat-stream";
import {
  formatAttachmentForProvider,
  processFile,
  validateAttachmentCount,
  type ProcessedAttachment,
  AttachmentError,
} from "./attachment-utils";

interface ChatState {
  conversations: ConversationRecord[];
  currentConversationId: string | null;
  messages: MessageRecord[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  pendingAttachments: ProcessedAttachment[];
  loadConversations: () => Promise<void>;
  createConversation: (providerId: string, modelId: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopGeneration: () => void;
  addAttachment: (file: File) => Promise<void>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
}

function sorted(conversations: ConversationRecord[]): ConversationRecord[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  error: null,
  pendingAttachments: [],

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
    });
  },

  deleteConversation: async (id) => {
    await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
      const messageIds = await db.messages.where("conversationId").equals(id).primaryKeys();
      for (const msgId of messageIds) {
        await db.attachments.where("messageId").equals(msgId).delete();
      }
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

  sendMessage: async (rawText) => {
    const text = rawText.trim();
    if ((!text && get().pendingAttachments.length === 0) || get().isStreaming) return;
    const provider = useProviderStore.getState().getDefaultProvider();
    if (!provider) return set({ error: "chat.noProvider" });
    const readinessError = providerReadinessError(provider);
    if (readinessError) return set({ error: readinessError });

    const attachments = get().pendingAttachments;
    let conversationId = get().currentConversationId;
    if (!conversationId)
      conversationId = await get().createConversation(provider.id, provider.modelId);
    const history = get().messages;
    const now = Date.now();
    const userMessage: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: text,
      status: "complete",
      createdAt: now,
    };
    if (attachments.length > 0) {
      userMessage.attachments = attachments.map((a) => ({
        id: a.id,
        messageId: userMessage.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        data: a.data,
        type: a.type,
        createdAt: now,
      }));
    }
    await db.messages.add(userMessage);
    if (attachments.length > 0) {
      await db.attachments.bulkPut(
        attachments.map((att) => ({ ...att, messageId: userMessage.id, createdAt: now })),
      );
    }
    set({
      messages: [...history, userMessage],
      isStreaming: true,
      streamingContent: "",
      error: null,
      pendingAttachments: [],
    });

    const streamMessages = [...history, userMessage]
      .filter((message) => message.status !== "error")
      .map(({ role, content: messageContent }) => {
        if (role === "user" && attachments.length > 0) {
          const parts: unknown[] = [{ type: "text", text: messageContent }];
          for (const att of attachments) {
            parts.push(formatAttachmentForProvider(att, provider.protocolId));
          }
          return { role, content: parts };
        }
        return { role, content: messageContent };
      });

    const streamResult = await streamAssistant(
      provider,
      conversationId,
      streamMessages,
      (streamingContent) => set({ streamingContent }),
    );

    const assistant: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId,
      role: "assistant",
      content: streamResult.content,
      status: streamResult.status,
      ...(streamResult.errorMessage ? { errorMessage: streamResult.errorMessage } : {}),
      createdAt: Date.now(),
    };
    const updatedAt = Date.now();
    const title = history.length === 0 ? text.slice(0, 60) : undefined;
    await db.transaction("rw", db.messages, db.conversations, async () => {
      await db.messages.add(assistant);
      await db.conversations.update(conversationId, {
        updatedAt,
        ...(title ? { title } : {}),
      });
    });
    set(({ conversations, currentConversationId: curId, messages }) => ({
      conversations: sorted(
        conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, updatedAt, ...(title ? { title } : {}) }
            : conversation,
        ),
      ),
      ...(curId === conversationId ? { messages: [...messages, assistant] } : {}),
      isStreaming: false,
      streamingContent: "",
      error: streamResult.errorMessage ?? null,
    }));
  },

  stopGeneration: stopActiveStream,
}));
