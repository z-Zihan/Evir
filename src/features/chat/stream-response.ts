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

function providerMessages(history: MessageRecord[], protocolId: string) {
  return history
    .filter((message) => message.status !== "error")
    .map(({ role, content, attachments }) => {
      if (role !== "user" || !attachments?.length) return { role, content };

      const parts: unknown[] = [{ type: "text", text: content }];
      for (const attachment of attachments) {
        parts.push(formatAttachmentForProvider(attachment, protocolId));
      }
      return { role, content: parts };
    });
}

function modeHint(mode: ChatState["mode"]): string {
  if (mode === "agent") return "You are in Agent mode. The user expects you to help with tasks.";
  if (mode === "plan") {
    return "You are in Plan mode. Analyze the request and provide a structured plan.";
  }
  return "";
}

export async function streamResponse(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
): Promise<void> {
  const provider = useProviderStore.getState().getDefaultProvider();
  if (!provider) return set({ error: "chat.noProvider" });
  const readinessError = providerReadinessError(provider);
  if (readinessError) return set({ error: readinessError });

  set({ isStreaming: true, streamingContent: "", error: null });
  const streamMessages = providerMessages(history, provider.protocolId);
  const hint = modeHint(get().mode);
  if (hint) streamMessages.unshift({ role: "system", content: hint });

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
  const conversation = get().conversations.find(({ id }) => id === conversationId);
  const firstMessage = history.length === 1 ? history[0] : undefined;
  const title =
    !conversation?.title && firstMessage?.role === "user"
      ? firstMessage.content.slice(0, 60)
      : undefined;

  await db.transaction("rw", db.messages, db.conversations, async () => {
    await db.messages.add(assistant);
    await db.conversations.update(conversationId, {
      updatedAt,
      ...(title ? { title } : {}),
    });
  });
  set(({ conversations, currentConversationId, messages }) => ({
    conversations: sorted(
      conversations.map((item) =>
        item.id === conversationId ? { ...item, updatedAt, ...(title ? { title } : {}) } : item,
      ),
    ),
    ...(currentConversationId === conversationId ? { messages: [...messages, assistant] } : {}),
    isStreaming: false,
    streamingContent: "",
    error: streamResult.errorMessage ?? null,
  }));
}
