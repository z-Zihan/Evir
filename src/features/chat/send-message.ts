import type { StoreApi } from "zustand";
import { db, type MessageRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { formatAttachmentForProvider } from "./attachment-utils";
import type { ChatState } from "./chat-store";
import { providerReadinessError, streamAssistant } from "./chat-stream";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

function sorted(conversations: ChatState["conversations"]): ChatState["conversations"] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

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
    isStreaming: true,
    streamingContent: "",
    error: null,
    pendingAttachments: [],
  });

  const streamMessages = [...history, userMessage]
    .filter((message) => message.status !== "error")
    .map(({ role, content }) => {
      if (role === "user" && attachments.length > 0) {
        const parts: unknown[] = [{ type: "text", text: content }];
        for (const attachment of attachments) {
          parts.push(formatAttachmentForProvider(attachment, provider.protocolId));
        }
        return { role, content: parts };
      }
      return { role, content };
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
}
