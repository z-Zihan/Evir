import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import { db, type ConversationRecord, type MessageRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { providerReadinessError, stopActiveStream, streamAssistant } from "./chat-stream";

interface ChatState {
  conversations: ConversationRecord[];
  currentConversationId: string | null;
  messages: MessageRecord[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  loadConversations: () => Promise<void>;
  createConversation: (providerId: string, modelId: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopGeneration: () => void;
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
    set({ currentConversationId: id, messages, streamingContent: "", error: null });
  },

  deleteConversation: async (id) => {
    await db.transaction("rw", db.conversations, db.messages, async () => {
      await db.messages.where("conversationId").equals(id).delete();
      await db.conversations.delete(id);
    });
    set(({ conversations, currentConversationId }) => ({
      conversations: conversations.filter((conversation) => conversation.id !== id),
      ...(currentConversationId === id
        ? { currentConversationId: null, messages: [], streamingContent: "" }
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

  sendMessage: async (rawText) => {
    const text = rawText.trim();
    // ChatView disables sending while streaming; keep this guard for non-UI callers.
    if (!text || get().isStreaming) return;
    const provider = useProviderStore.getState().getDefaultProvider();
    if (!provider) return set({ error: "chat.noProvider" });
    const readinessError = providerReadinessError(provider);
    if (readinessError) return set({ error: readinessError });

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
    await db.messages.add(userMessage);
    set({
      messages: [...history, userMessage],
      isStreaming: true,
      streamingContent: "",
      error: null,
    });

    const streamResult = await streamAssistant(
      provider,
      conversationId,
      [...history, userMessage]
        .filter((message) => message.status !== "error")
        .map(({ role, content: messageContent }) => ({ role, content: messageContent })),
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
    set(({ conversations, currentConversationId, messages }) => ({
      conversations: sorted(
        conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, updatedAt, ...(title ? { title } : {}) }
            : conversation,
        ),
      ),
      ...(currentConversationId === conversationId ? { messages: [...messages, assistant] } : {}),
      isStreaming: false,
      streamingContent: "",
      error: streamResult.errorMessage ?? null,
    }));
  },

  stopGeneration: stopActiveStream,
}));
