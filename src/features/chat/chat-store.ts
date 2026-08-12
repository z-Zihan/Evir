import { create } from "zustand";
// NOTE: Uses Dexie directly for indexed queries; StoragePort covers basic CRUD
import type { AttachmentRecord, ConversationRecord, MessageRecord } from "../../core/storage/db";
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
  createOrReuseConversation as doCreateOrReuseConversation,
  selectConversation as doSelectConversation,
  deleteConversation as doDeleteConversation,
  renameConversation as doRenameConversation,
  togglePin as doTogglePin,
  updateConversationProvider as doUpdateConversationProvider,
} from "./conversation-ops";
import { getStructuredStorage } from "../../runtime/structured-storage";
import type { AgentRunRecord } from "./agent-run-record";
import { useSkillStore } from "../skills/skill-store";
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
  privateConversationId: string | null;
  latestAgentRun: AgentRunRecord | null;
  selectedSkillIds: Set<string>;
  loadConversations: () => Promise<void>;
  createConversation: (providerId: string, modelId: string) => Promise<string>;
  createOrReuseConversation: (providerId: string, modelId: string) => Promise<string>;
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
  toggleSelectedSkill: (id: string) => void;
  clearSelectedSkills: () => void;
}
export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  mode: "agent",
  isStreaming: false,
  streamingContent: "",
  error: null,
  pendingAttachments: [],
  pendingToolApproval: null,
  privateSession: false,
  privateConversationId: null,
  latestAgentRun: null,
  selectedSkillIds: new Set<string>(),
  loadConversations: async () => doLoadConversations(set),
  createConversation: async (providerId, modelId) =>
    doCreateConversation(set, providerId, modelId, get().privateSession),
  createOrReuseConversation: async (providerId, modelId) =>
    doCreateOrReuseConversation(set, get, providerId, modelId),
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
  toggleSelectedSkill: (id) =>
    set((state) => {
      const next = new Set(state.selectedSkillIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedSkillIds: next };
    }),
  clearSelectedSkills: () => set({ selectedSkillIds: new Set<string>() }),
  setMode: (mode) =>
    set((state) => {
      if (mode !== "ask") return { mode };
      const compatibleIds = new Set(
        useSkillStore
          .getState()
          .skills.filter((skill) => skill.manifest.capabilities.length === 0)
          .map((skill) => skill.manifest.id),
      );
      return {
        mode,
        selectedSkillIds: new Set(
          [...state.selectedSkillIds].filter((skillId) => compatibleIds.has(skillId)),
        ),
      };
    }),
  togglePrivateSession: () =>
    set((state) => {
      if (state.isStreaming) return {};
      if (!state.privateSession) {
        return {
          privateSession: true,
          privateConversationId: null,
          currentConversationId: null,
          messages: [],
          streamingContent: "",
          pendingAttachments: [],
          selectedSkillIds: new Set<string>(),
          pendingToolApproval: null,
          error: null,
          latestAgentRun: null,
        };
      }
      return {
        privateSession: false,
        conversations: state.privateConversationId
          ? state.conversations.filter(({ id }) => id !== state.privateConversationId)
          : state.conversations,
        privateConversationId: null,
        currentConversationId: null,
        messages: [],
        streamingContent: "",
        pendingAttachments: [],
        selectedSkillIds: new Set<string>(),
        pendingToolApproval: null,
        error: null,
        latestAgentRun: null,
      };
    }),
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
    if (!get().privateSession) {
      await getStructuredStorage().delete("messages", lastAssistant.id);
    }
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
    if (!get().privateSession) {
      const storage = getStructuredStorage();
      const attachments = await storage.readAll<AttachmentRecord>("attachments");
      const deleteIdSet = new Set(deleteIds);
      await storage.apply([
        {
          type: "write",
          entity: "messages",
          id: messageId,
          data: { ...message, content: newContent },
        },
        ...attachments
          .filter(({ messageId: attachmentMessageId }) => deleteIdSet.has(attachmentMessageId))
          .map(({ id }) => ({ type: "delete" as const, entity: "attachments" as const, id })),
        ...deleteIds.map((id) => ({ type: "delete" as const, entity: "messages" as const, id })),
      ]);
    }
    const updated = messages.slice(0, index + 1);
    updated[index] = { ...message, content: newContent };
    set({ messages: updated, pendingToolApproval: null });
    await streamResponse(set, get, updated, currentConversationId, getRuntime());
  },
  stopGeneration: () => {
    stopActiveStream();
    void getRuntime().storage?.cancelActiveCommands();
  },
  branchConversation: async (messageId) => {
    const { currentConversationId, messages, conversations, isStreaming, privateSession } = get();
    if (privateSession) throw new Error("Cannot branch a private session");
    if (!currentConversationId || isStreaming) throw new Error("Cannot branch now");
    const conversation = conversations.find((c) => c.id === currentConversationId);
    if (!conversation) throw new Error("Conversation not found");
    const newId = await doBranchConversation(messages, conversation, messageId);
    await get().loadConversations();
    await get().selectConversation(newId);
    return newId;
  },
}));
