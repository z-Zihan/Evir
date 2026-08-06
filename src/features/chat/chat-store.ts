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
import {
  loadConversations as doLoadConversations,
  createConversation as doCreateConversation,
  selectConversation as doSelectConversation,
  deleteConversation as doDeleteConversation,
  renameConversation as doRenameConversation,
  togglePin as doTogglePin,
  updateConversationProvider as doUpdateConversationProvider,
} from "./conversation-ops";
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
  privateSession: boolean;
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
  togglePrivateSession: () => void;
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
  privateSession: false,
  loadConversations: async () => doLoadConversations(set),
  createConversation: async (providerId, modelId) => doCreateConversation(set, providerId, modelId),
  selectConversation: async (id) => doSelectConversation(set, id),
  deleteConversation: async (id) => doDeleteConversation(set, id),
  renameConversation: async (id, title) => doRenameConversation(set, id, title),
  togglePin: async (id) => doTogglePin(set, get, id),
  updateConversationProvider: async (providerId, modelId) =>
    doUpdateConversationProvider(set, get, providerId, modelId),
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
  togglePrivateSession: () => set((s) => ({ privateSession: !s.privateSession })),
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
