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
import { onProjectRemoved } from "../projects/project-events";
import {
  approveTool,
  cancelPendingToolApprovals,
  denyTool,
  type PendingToolApproval,
} from "./tool-approval";
import {
  bumpStreamEpoch,
  beginPreparation,
  endPreparation,
  hasActiveStream,
  mirrorCurrentStreamState,
  slotFor,
} from "./stream-ownership";
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
import { cancelTaskPreparation } from "../orchestration/orchestration-session";
import { logger } from "../../core/logging/logger";
import type { AgentRunRecord } from "./agent-run-record";
import { useSkillStore } from "../skills/skill-store";

/** Live run state for ONE conversation — the unit of multi-task isolation. */
export interface StreamSlot {
  conversationId: string;
  /** "preparing" covers the intake/plan round trips before any tokens stream. */
  phase: "preparing" | "streaming";
  /** Wall-clock of beginConversationStream; null while preparing. */
  startedAt: number | null;
  /** Latest streamed content — survives switching away and back. */
  content: string;
}

export interface ChatState {
  conversations: ConversationRecord[];
  currentConversationId: string | null;
  messages: MessageRecord[];
  mode: InteractionMode;
  isStreaming: boolean;
  activeStreamConversationId: string | null;
  activeStreamStartedAt: number | null;
  /** Incremented on every stop so in-flight preparation sends can detect cancellation. */
  streamEpoch: number;
  streamingContent: string;
  error: string | null;
  pendingAttachments: ProcessedAttachment[];
  pendingToolApproval: PendingToolApproval | null;
  privateSession: boolean;
  privateConversationId: string | null;
  latestAgentRun: AgentRunRecord | null;
  selectedSkillIds: Set<string>;
  /** Source of truth for concurrent runs, keyed by conversationId. */
  streamSlots: Record<string, StreamSlot>;
  /** Per-conversation stop epochs (the global streamEpoch is kept for logging only). */
  streamEpochs: Record<string, number>;
  /** Pending tool approvals keyed by conversationId; the flat field mirrors the viewed one. */
  pendingApprovals: Record<string, PendingToolApproval>;
  /** Last settled outcome per conversation (background runs included) for sidebar status. */
  runOutcomes: Record<string, { status: "completed" | "failed" | "stopped"; at: number }>;
  /** Wall-clock of the last time each conversation was viewed (unread dots). */
  conversationViewedAt: Record<string, number>;
  loadConversations: () => Promise<void>;
  createConversation: (
    providerId: string,
    modelId: string,
    projectId?: string | null,
  ) => Promise<string>;
  createOrReuseConversation: (
    providerId: string,
    modelId: string,
    projectId?: string | null,
  ) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  updateConversationProvider: (providerId: string, modelId: string) => Promise<void>;
  /** Resolves after the run settles; onAccepted fires once the user message is safely accepted. */
  sendMessage: (text: string, onAccepted?: () => void) => Promise<boolean>;
  regenerate: () => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  /** Stops ONE conversation's run (defaults to the viewed conversation); others keep running. */
  stopGeneration: (conversationId?: string) => void;
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
  activeStreamConversationId: null,
  activeStreamStartedAt: null,
  streamEpoch: 0,
  streamingContent: "",
  error: null,
  pendingAttachments: [],
  pendingToolApproval: null,
  privateSession: false,
  privateConversationId: null,
  latestAgentRun: null,
  selectedSkillIds: new Set<string>(),
  streamSlots: {},
  streamEpochs: {},
  pendingApprovals: {},
  runOutcomes: {},
  conversationViewedAt: {},
  loadConversations: async () => doLoadConversations(set),
  createConversation: async (providerId, modelId, projectId = null) =>
    doCreateConversation(set, providerId, modelId, get().privateSession, projectId),
  createOrReuseConversation: async (providerId, modelId, projectId = null) =>
    doCreateOrReuseConversation(set, get, providerId, modelId, projectId),
  selectConversation: async (id) => doSelectConversation(set, get, id),
  deleteConversation: async (id) => {
    // Deleting a conversation that is running must stop its run first —
    // otherwise it keeps burning tokens and persists orphan rows for a
    // conversation that no longer exists.
    if (slotFor(get(), id)) get().stopGeneration(id);
    return doDeleteConversation(set, get, id);
  },
  renameConversation: async (id, title) => doRenameConversation(set, id, title),
  togglePin: async (id) => doTogglePin(set, get, id),
  updateConversationProvider: async (providerId, modelId) =>
    doUpdateConversationProvider(set, get, providerId, modelId),
  addAttachment: async (file) => {
    if (!validateAttachmentCount(get().pendingAttachments.length)) {
      set({ error: "chat.attachmentLimit" });
      return;
    }
    try {
      const processed = await processFile(file);
      // FileReader completions can race when a multi-select or drop contains
      // several files. Resolve against the latest state at commit time so one
      // attachment cannot overwrite another, while still enforcing the cap.
      set((state) =>
        validateAttachmentCount(state.pendingAttachments.length)
          ? { pendingAttachments: [...state.pendingAttachments, processed], error: null }
          : { error: "chat.attachmentLimit" },
      );
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
      if (hasActiveStream(state)) return {};
      if (!state.privateSession) {
        return {
          privateSession: true,
          privateConversationId: null,
          currentConversationId: null,
          activeStreamConversationId: null,
          activeStreamStartedAt: null,
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
        activeStreamConversationId: null,
        activeStreamStartedAt: null,
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
    const conversationId = get().currentConversationId;
    const pending = conversationId ? get().pendingApprovals?.[conversationId] : undefined;
    if (!pending) return;
    await approveTool(pending, set, get);
  },
  denyTool: async () => {
    const conversationId = get().currentConversationId;
    const pending = conversationId ? get().pendingApprovals?.[conversationId] : undefined;
    if (!pending) return;
    await denyTool(pending, set, get);
  },
  sendMessage: (text, onAccepted) => sendChatMessage(set, get, text, onAccepted),
  regenerate: async () => {
    const { messages, currentConversationId } = get();
    if (!currentConversationId || slotFor(get(), currentConversationId)) return;
    const lastAssistant = [...messages].reverse().find(({ role }) => role === "assistant");
    if (!lastAssistant) return;
    // Claim the busy slot before the storage await: a double-click during it
    // would otherwise launch two concurrent streams for one conversation.
    const epoch = beginPreparation(set, get, currentConversationId);
    try {
      if (!get().privateSession) {
        await getStructuredStorage().delete("messages", lastAssistant.id);
      }
      const history = get().messages.filter(({ id }) => id !== lastAssistant.id);
      set((state) => {
        const pendingApprovals = { ...state.pendingApprovals };
        delete pendingApprovals[currentConversationId];
        return { messages: history, pendingApprovals, pendingToolApproval: null };
      });
      await streamResponse(set, get, history, currentConversationId, getRuntime());
    } finally {
      endPreparation(set, get, currentConversationId, epoch);
    }
  },
  editMessage: async (messageId, newContent) => {
    const { messages, currentConversationId } = get();
    if (!currentConversationId || slotFor(get(), currentConversationId)) return;
    const index = messages.findIndex(({ id }) => id === messageId);
    const message = messages[index];
    if (!message || message.role !== "user") return;
    const epoch = beginPreparation(set, get, currentConversationId);
    try {
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
      set((state) => {
        const pendingApprovals = { ...state.pendingApprovals };
        delete pendingApprovals[currentConversationId];
        return { messages: updated, pendingApprovals, pendingToolApproval: null };
      });
      await streamResponse(set, get, updated, currentConversationId, getRuntime());
    } finally {
      endPreparation(set, get, currentConversationId, epoch);
    }
  },
  stopGeneration: (conversationId) => {
    const target = conversationId ?? get().currentConversationId;
    if (!target) return;
    const state = get();
    const slot = slotFor(state, target);
    const othersRunning = Object.keys(state.streamSlots).some((id) => id !== target);
    logger.info("stream", "stream.stop-requested", {
      conversationId: target,
      phase: slot ? slot.phase : "approval-or-idle",
    });
    // Abort only this conversation's in-flight requests; concurrent tasks in
    // other conversations must not notice the stop.
    stopActiveStream(target);
    // Cancellation must also reach the agent/goal preparation pipeline: its
    // intake/plan round trips run before any stream slot opens, so without
    // this marker a finished preparation would just start the next stream
    // and the spinner would come back after the user pressed stop.
    cancelTaskPreparation(target);
    if (!othersRunning) void getRuntime().storage?.cancelActiveCommands();
    void cancelPendingToolApprovals(state.pendingApprovals[target] ?? null, state.privateSession);
    set((current) => {
      const streamSlots = { ...current.streamSlots };
      delete streamSlots[target];
      const pendingApprovals = { ...current.pendingApprovals };
      delete pendingApprovals[target];
      return {
        streamSlots,
        pendingApprovals,
        streamEpoch: current.streamEpoch + 1,
      };
    });
    bumpStreamEpoch(set, target);
    mirrorCurrentStreamState(set, get);
  },
  branchConversation: async (messageId) => {
    const { currentConversationId, messages, conversations, privateSession } = get();
    if (privateSession) throw new Error("Cannot branch a private session");
    if (!currentConversationId || slotFor(get(), currentConversationId))
      throw new Error("Cannot branch now");
    const conversation = conversations.find((c) => c.id === currentConversationId);
    if (!conversation) throw new Error("Conversation not found");
    const newId = await doBranchConversation(messages, conversation, messageId);
    await get().loadConversations();
    await get().selectConversation(newId);
    return newId;
  },
}));

// Projects never import this store (cycle-free direction chat → projects);
// they announce removals via project-events and the chat side detaches here.
onProjectRemoved((projectId) => {
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.projectId === projectId
        ? { ...conversation, projectId: null, updatedAt: Date.now() }
        : conversation,
    ),
  }));
});
