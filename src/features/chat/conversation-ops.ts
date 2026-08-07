import type { StoreApi } from "zustand";
import type { ConversationRecord, MessageRecord } from "../../core/storage/db";
import type { ChatState } from "./chat-store";
import { getStructuredStorage } from "../../runtime/structured-storage";
import type { AgentRunRecord } from "./agent-run-record";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export async function loadConversations(set: ChatStoreSet): Promise<void> {
  const conversations = await getStructuredStorage().readAll<ConversationRecord>("conversations");
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  set({ conversations });
}

export async function createConversation(
  set: ChatStoreSet,
  providerId: string,
  modelId: string,
  privateSession = false,
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
  return createConversation(set, providerId, modelId, get().privateSession);
}

export async function selectConversation(set: ChatStoreSet, id: string): Promise<void> {
  const storage = getStructuredStorage();
  const [messages, agentRuns] = await Promise.all([
    storage.query<MessageRecord>("messages", { conversationId: id }),
    storage.query<AgentRunRecord>("agent_runs", { conversationId: id }),
  ]);
  messages.sort((a, b) => a.createdAt - b.createdAt);
  agentRuns.sort((a, b) => b.updatedAt - a.updatedAt);
  set({
    currentConversationId: id,
    messages,
    streamingContent: "",
    error: null,
    pendingAttachments: [],
    pendingToolApproval: null,
    latestAgentRun: agentRuns[0] ?? null,
  });
}

export async function deleteConversation(set: ChatStoreSet, id: string): Promise<void> {
  const storage = getStructuredStorage();
  const [messages, agentRuns, toolExecutions] = await Promise.all([
    storage.query<MessageRecord>("messages", { conversationId: id }),
    storage.query<{ id: string; conversationId: string }>("agent_runs", { conversationId: id }),
    storage.query<{ id: string; conversationId: string }>("tool_executions", {
      conversationId: id,
    }),
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
    { type: "delete", entity: "conversations", id },
  ]);
  set(({ conversations, currentConversationId }) => ({
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
  }));
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
