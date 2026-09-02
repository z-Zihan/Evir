import type { StoreApi } from "zustand";
import type { ConversationRecord, MessageRecord } from "../../core/storage/db";
import type { ChatState } from "./chat-store";
import { getStructuredStorage } from "../../runtime/structured-storage";
import type { AgentRunRecord } from "./agent-run-record";
import type { MemoryRecord } from "../../core/memory/types";
import { OrchestrationRepository } from "../../core/orchestration/repository";
import type { AgentAssignment, RunEventV1, TaskBrief } from "../../core/orchestration/types";
import { useOrchestrationStore } from "../orchestration/orchestration-store";
import { fromApprovalRecord, type ApprovalRecord } from "./tool-approval";
import { mirrorCurrentStreamState } from "./stream-ownership";
import { logger } from "../../core/logging/logger";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export async function loadConversations(set: ChatStoreSet): Promise<void> {
  const conversations = await getStructuredStorage().readAll<ConversationRecord>("conversations");
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  set((state) => {
    // Seed viewedAt for conversations not yet seen this session: their
    // current state counts as "seen" so only post-launch updates mark unread.
    const conversationViewedAt = { ...state.conversationViewedAt };
    const loadedAt = Date.now();
    for (const conversation of conversations) {
      if (conversationViewedAt[conversation.id] === undefined) {
        conversationViewedAt[conversation.id] = loadedAt;
      }
    }
    return { conversations, conversationViewedAt };
  });
}

export async function createConversation(
  set: ChatStoreSet,
  providerId: string,
  modelId: string,
  privateSession = false,
  projectId: string | null = null,
): Promise<string> {
  const now = Date.now();
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    title: "",
    providerId,
    modelId,
    createdAt: now,
    updatedAt: now,
    ...(projectId ? { projectId } : { projectId: null }),
  };
  if (!privateSession) {
    await getStructuredStorage().write("conversations", conversation.id, conversation);
  }
  set(({ conversations }) => ({
    conversations: [conversation, ...conversations],
    currentConversationId: conversation.id,
    privateConversationId: privateSession ? conversation.id : null,
    messages: [],
    error: null,
    latestAgentRun: null,
  }));
  useOrchestrationStore.getState().setViewedConversation(conversation.id);
  return conversation.id;
}

export async function createOrReuseConversation(
  set: ChatStoreSet,
  get: ChatStoreGet,
  providerId: string,
  modelId: string,
  projectId: string | null = null,
): Promise<string> {
  const { currentConversationId, messages } = get();
  if (currentConversationId && messages.length === 0) {
    // Reuse only within the same project context; switching context starts a
    // new thread instead of silently re-assigning the existing one.
    const existing = get().conversations.find(({ id }) => id === currentConversationId);
    if ((existing?.projectId ?? null) === projectId) return currentConversationId;
  }
  return createConversation(set, providerId, modelId, get().privateSession, projectId);
}

export async function selectConversation(
  set: ChatStoreSet,
  get: ChatStoreGet,
  id: string,
): Promise<void> {
  set({
    currentConversationId: id,
    messages: [],
    streamingContent: "",
    error: null,
    pendingAttachments: [],
    pendingToolApproval: null,
    latestAgentRun: null,
  });
  // Restore the incoming conversation's live run view: a background task keeps
  // streaming while the user was looking elsewhere.
  mirrorCurrentStreamState(set, get, id);
  useOrchestrationStore.getState().setViewedConversation(id);
  logger.debug("ui", "chat.conversation-selected", { conversationId: id });
  const storage = getStructuredStorage();
  const [messages, agentRuns, orchestration, approvalRecords] = await Promise.all([
    storage.query<MessageRecord>("messages", { conversationId: id }),
    storage.query<AgentRunRecord>("agent_runs", { conversationId: id }),
    new OrchestrationRepository(storage).loadLatestSnapshotForConversation(id),
    storage.query<ApprovalRecord>("approvals", { conversationId: id, status: "pending" }),
  ]);
  messages.sort((a, b) => a.createdAt - b.createdAt);
  agentRuns.sort((a, b) => b.updatedAt - a.updatedAt);
  approvalRecords.sort((a, b) => a.createdAt - b.createdAt);
  const approvals = approvalRecords.map(fromApprovalRecord);
  const [pendingToolApproval, ...remainingApprovals] = approvals;
  if (get().currentConversationId !== id) {
    logger.debug("ui", "chat.conversation-load-discarded", { conversationId: id });
    return;
  }
  set((state) => {
    // Viewing a conversation marks its results as seen (sidebar unread dots)
    // and clears its settled-outcome mark.
    const runOutcomes = { ...state.runOutcomes };
    delete runOutcomes[id];
    return {
      messages,
      runOutcomes,
      conversationViewedAt: { ...state.conversationViewedAt, [id]: Date.now() },
      // An in-memory approval (live run in this conversation) wins over the
      // storage reload; only fall back to persisted approvals when absent.
      ...(!state.pendingApprovals?.[id] && pendingToolApproval
        ? {
            pendingApprovals: {
              ...state.pendingApprovals,
              [id]: { ...pendingToolApproval, remainingApprovals },
            },
          }
        : {}),
      latestAgentRun: agentRuns[0] ?? null,
    };
  });
  mirrorCurrentStreamState(set, get, id);
  if (orchestration && !useOrchestrationStore.getState().snapshotFor(id)) {
    useOrchestrationStore.getState().setCurrent(orchestration);
  }
}

export async function deleteConversation(
  set: ChatStoreSet,
  get: ChatStoreGet,
  id: string,
): Promise<void> {
  const storage = getStructuredStorage();
  const [messages, agentRuns, toolExecutions, conversationMemories, briefs, plans, events] =
    await Promise.all([
      storage.query<MessageRecord>("messages", { conversationId: id }),
      storage.query<{ id: string; conversationId: string }>("agent_runs", { conversationId: id }),
      storage.query<{ id: string; conversationId: string }>("tool_executions", {
        conversationId: id,
      }),
      storage.query<MemoryRecord>("memories", { scope: id }),
      storage.query<TaskBrief>("task_briefs", { conversationId: id }),
      storage.query<{ id: string; runId: string; conversationId: string }>("plans", {
        conversationId: id,
      }),
      storage.query<RunEventV1>("run_events", { conversationId: id }),
    ]);
  const runIds = new Set(briefs.map(({ runId }) => runId));
  const [steps, assignments, approvals] = await Promise.all([
    storage.readAll<{ id: string; runId: string }>("run_steps"),
    storage.readAll<AgentAssignment>("agent_assignments"),
    storage.readAll<{ id: string; runId: string }>("approvals"),
  ]);
  const messageIds = new Set(messages.map(({ id: messageId }) => messageId));
  const attachments = await storage.readAll<{ id: string; messageId: string }>("attachments");
  await storage.apply([
    ...attachments
      .filter(({ messageId }) => messageIds.has(messageId))
      .map(({ id: attachmentId }) => ({
        type: "delete" as const,
        entity: "attachments" as const,
        id: attachmentId,
      })),
    ...messages.map(({ id: messageId }) => ({
      type: "delete" as const,
      entity: "messages" as const,
      id: messageId,
    })),
    ...toolExecutions.map(({ id: executionId }) => ({
      type: "delete" as const,
      entity: "tool_executions" as const,
      id: executionId,
    })),
    ...agentRuns.map(({ id: runId }) => ({
      type: "delete" as const,
      entity: "agent_runs" as const,
      id: runId,
    })),
    ...briefs.map(({ id: briefId }) => ({
      type: "delete" as const,
      entity: "task_briefs" as const,
      id: briefId,
    })),
    ...plans.map(({ id: planId }) => ({
      type: "delete" as const,
      entity: "plans" as const,
      id: planId,
    })),
    ...steps
      .filter(({ runId }) => runIds.has(runId))
      .map(({ id: stepId }) => ({
        type: "delete" as const,
        entity: "run_steps" as const,
        id: stepId,
      })),
    ...events.map(({ id: eventId }) => ({
      type: "delete" as const,
      entity: "run_events" as const,
      id: eventId,
    })),
    ...assignments
      .filter(({ parentRunId }) => runIds.has(parentRunId))
      .map(({ id: assignmentId }) => ({
        type: "delete" as const,
        entity: "agent_assignments" as const,
        id: assignmentId,
      })),
    ...approvals
      .filter(({ runId }) => runIds.has(runId))
      .map(({ id: approvalId }) => ({
        type: "delete" as const,
        entity: "approvals" as const,
        id: approvalId,
      })),
    ...conversationMemories.map(({ id: memoryId }) => ({
      type: "delete" as const,
      entity: "memories" as const,
      id: memoryId,
    })),
    { type: "delete", entity: "settings", id: `checkpoint:${id}` },
    { type: "delete", entity: "conversations", id },
  ]);
  set(({ conversations, currentConversationId, streamSlots, pendingApprovals }) => ({
    conversations: conversations.filter((c) => c.id !== id),
    ...(currentConversationId === id
      ? {
          currentConversationId: null,
          messages: [],
          streamingContent: "",
          pendingAttachments: [],
          pendingToolApproval: null,
          latestAgentRun: null,
        }
      : {}),
    // Drop the deleted conversation's live-run bookkeeping either way.
    ...(streamSlots?.[id] || pendingApprovals?.[id]
      ? (() => {
          const nextSlots = { ...streamSlots };
          delete nextSlots[id];
          const nextApprovals = { ...pendingApprovals };
          delete nextApprovals[id];
          return { streamSlots: nextSlots, pendingApprovals: nextApprovals };
        })()
      : {}),
  }));
  useOrchestrationStore.getState().discardConversation(id);
  mirrorCurrentStreamState(set, get);
}

export async function renameConversation(
  set: ChatStoreSet,
  id: string,
  title: string,
): Promise<void> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;
  const storage = getStructuredStorage();
  const current = await storage.read<ConversationRecord>("conversations", id);
  if (!current) return;
  await storage.write("conversations", id, {
    ...current,
    title: cleanTitle,
    updatedAt: Date.now(),
  });
  set(({ conversations }) => ({
    conversations: conversations.map((c) => (c.id === id ? { ...c, title: cleanTitle } : c)),
  }));
}

export async function togglePin(set: ChatStoreSet, get: ChatStoreGet, id: string): Promise<void> {
  const conv = get().conversations.find((c) => c.id === id);
  const newPinned = conv?.pinned ? 0 : 1;
  try {
    const current = await getStructuredStorage().read<ConversationRecord>("conversations", id);
    if (!current) return;
    await getStructuredStorage().write("conversations", id, {
      ...current,
      pinned: newPinned,
      updatedAt: Date.now(),
    });
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
  const current = await getStructuredStorage().read<ConversationRecord>(
    "conversations",
    currentConversationId,
  );
  if (!current) return;
  await getStructuredStorage().write("conversations", currentConversationId, {
    ...current,
    providerId,
    modelId,
    updatedAt: now,
  });
  set(({ conversations }) => ({
    conversations: conversations.map((c) =>
      c.id === currentConversationId ? { ...c, providerId, modelId, updatedAt: now } : c,
    ),
  }));
}
