import type { StoreApi } from "zustand";
import { db, type MessageRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import type { ChatState } from "./chat-store";
import { providerReadinessError } from "./chat-stream";
import { streamResponse } from "./stream-response";
import { getRuntime } from "../../runtime/use-runtime";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export async function sendChatMessage(
  set: ChatStoreSet,
  get: ChatStoreGet,
  rawText: string,
): Promise<void> {
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
    userMessage.attachments = attachments.map((attachment) => ({
      id: attachment.id,
      messageId: userMessage.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      data: attachment.data,
      type: attachment.type,
      createdAt: now,
    }));
  }
  await db.messages.add(userMessage);

  // Auto-generate title
  const conversation = get().conversations.find((c) => c.id === conversationId);
  if (conversation && !conversation.title && text) {
    const autoTitle = text.length > 30 ? `${text.slice(0, 30)}…` : text;
    await db.conversations.update(conversationId, { title: autoTitle, updatedAt: Date.now() });
    set(({ conversations: convs }) => ({
      conversations: convs.map((c) => (c.id === conversationId ? { ...c, title: autoTitle } : c)),
    }));
  }

  if (attachments.length > 0) {
    await db.attachments.bulkPut(
      attachments.map((attachment) => ({
        ...attachment,
        messageId: userMessage.id,
        createdAt: now,
      })),
    );
  }
  set({
    messages: [...history, userMessage],
    pendingAttachments: [],
  });
  await streamResponse(set, get, [...history, userMessage], conversationId, getRuntime());
}
