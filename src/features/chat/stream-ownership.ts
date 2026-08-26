import type { StoreApi } from "zustand";
import { logger } from "../../core/logging/logger";
import type { ChatState } from "./chat-store";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export function beginConversationStream(set: ChatStoreSet, conversationId: string): number {
  const startedAt = Date.now();
  set({
    isStreaming: true,
    activeStreamConversationId: conversationId,
    activeStreamStartedAt: startedAt,
    streamingContent: "",
    error: null,
  });
  logger.info("stream", "chat.stream-started", { conversationId });
  return startedAt;
}

export function updateConversationStream(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  streamingContent: string,
): void {
  const state = get();
  if (
    state.activeStreamConversationId !== conversationId ||
    state.currentConversationId !== conversationId
  ) {
    return;
  }
  set({ streamingContent });
}

export function finishConversationStream(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  startedAt: number,
): void {
  const durationMs = Date.now() - startedAt;
  set((state) =>
    state.activeStreamConversationId === conversationId
      ? {
          isStreaming: false,
          activeStreamConversationId: null,
          activeStreamStartedAt: null,
          ...(state.currentConversationId === conversationId ? { streamingContent: "" } : {}),
        }
      : {},
  );
  logger.info("stream", "chat.stream-completed", { conversationId, durationMs });
}

export function visibleForConversation(get: ChatStoreGet, conversationId: string): boolean {
  return get().currentConversationId === conversationId;
}
