import type { StoreApi } from "zustand";
import { logger } from "../../core/logging/logger";
import type { ChatState, StreamSlot } from "./chat-contracts";
import type { PendingToolApproval } from "./chat-contracts";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export function slotFor(
  state: Pick<ChatState, "streamSlots">,
  conversationId: string | null | undefined,
): StreamSlot | undefined {
  return conversationId ? state.streamSlots?.[conversationId] : undefined;
}

/** True while ANY conversation has an in-flight run (used by global gates like private mode). */
export function hasActiveStream(state: Pick<ChatState, "streamSlots">): boolean {
  return Object.keys(state.streamSlots ?? {}).length > 0;
}

/**
 * The legacy single-stream fields (isStreaming / activeStreamConversationId /
 * streamingContent / pendingToolApproval) are now VIEW mirrors of the currently
 * selected conversation's slot — the source of truth is `streamSlots`, keyed by
 * conversation, so several tasks can run concurrently.
 */
export function mirrorCurrentStreamState(set: ChatStoreSet, get: ChatStoreGet): void {
  // Always mirrors the conversation CURRENTLY on screen — a background task's
  // slot/approval updates must never flip the view onto another conversation.
  const target = get().currentConversationId;
  const slot = slotFor(get(), target);
  const approval = target ? get().pendingApprovals?.[target] : undefined;
  set({
    isStreaming: Boolean(slot),
    activeStreamConversationId: slot && slot.phase === "streaming" ? target : null,
    activeStreamStartedAt: slot && slot.phase === "streaming" ? (slot.startedAt ?? null) : null,
    streamingContent: slot ? slot.content : "",
    pendingToolApproval: approval ?? null,
  });
}

/** Per-conversation stop epoch; bumped on stop so in-flight preparations detect it. */
export function streamEpochFor(
  state: Pick<ChatState, "streamEpochs">,
  conversationId: string,
): number {
  return state.streamEpochs?.[conversationId] ?? 0;
}

/** Marks a conversation as preparing (before any stream slot opens). Returns the captured epoch. */
export function beginPreparation(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
): number {
  const epoch = streamEpochFor(get(), conversationId);
  set((state) => ({
    streamSlots: {
      ...state.streamSlots,
      [conversationId]: {
        conversationId,
        phase: "preparing",
        startedAt: null,
        content: "",
      },
    },
  }));
  mirrorCurrentStreamState(set, get);
  return epoch;
}

/**
 * Removes a preparing slot (early exit paths: cancelled / clarification /
 * preparation failure). A slot that has moved on to streaming is untouched.
 */
export function endPreparation(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  epoch: number,
): void {
  const slot = slotFor(get(), conversationId);
  if (!slot || slot.phase !== "preparing") return;
  if (streamEpochFor(get(), conversationId) !== epoch) return;
  set((state) => {
    const streamSlots = { ...state.streamSlots };
    delete streamSlots[conversationId];
    return { streamSlots };
  });
  mirrorCurrentStreamState(set, get);
}

export function beginConversationStream(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
): number {
  const startedAt = Date.now();
  set((state) => ({
    streamSlots: {
      ...state.streamSlots,
      [conversationId]: {
        conversationId,
        phase: "streaming",
        startedAt,
        content: "",
      },
    },
  }));
  mirrorCurrentStreamState(set, get);
  logger.info("stream", "chat.stream-started", { conversationId });
  return startedAt;
}

export function updateConversationStream(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  streamingContent: string,
): void {
  const slot = slotFor(get(), conversationId);
  if (!slot) return;
  set((state) => ({
    streamSlots: {
      ...state.streamSlots,
      [conversationId]: { ...slot, content: streamingContent },
    },
    // The view mirror only carries content for the conversation on screen;
    // background tasks keep theirs inside the slot for switch-back restore.
    ...(state.currentConversationId === conversationId ? { streamingContent } : {}),
  }));
}

/**
 * streaming → verifying: the model finished; automatic verification
 * (agent-run evidence, done-when checks) is running before the turn lands.
 */
export function beginConversationVerification(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  startedAt: number,
): void {
  const slot = slotFor(get(), conversationId);
  if (!slot || slot.phase !== "streaming" || slot.startedAt !== startedAt) return;
  set((state) => ({
    streamSlots: {
      ...state.streamSlots,
      [conversationId]: { ...slot, phase: "verifying" },
    },
  }));
  mirrorCurrentStreamState(set, get);
}

export function finishConversationStream(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  startedAt: number,
): void {
  const durationMs = Date.now() - startedAt;
  // The startedAt match matters when a stopped run's persistence tail is still
  // draining while a NEWER run has begun in the same conversation: without it
  // the old tail would delete the new run's slot.
  const slot = slotFor(get(), conversationId);
  if (
    slot &&
    (slot.phase === "streaming" || slot.phase === "verifying") &&
    slot.startedAt === startedAt
  ) {
    set((state) => {
      const streamSlots = { ...state.streamSlots };
      delete streamSlots[conversationId];
      return { streamSlots };
    });
    mirrorCurrentStreamState(set, get);
  }
  logger.info("stream", "chat.stream-completed", { conversationId, durationMs });
}

/** True when no newer run owns the conversation (stopped tails still land). */
export function ownsConversationSlot(
  get: ChatStoreGet,
  conversationId: string,
  startedAt: number,
): boolean {
  const slot = slotFor(get(), conversationId);
  if (!slot) return true;
  return slot.phase !== "streaming" || slot.startedAt === startedAt;
}

/** Records a pending approval for one conversation and mirrors it when visible. */
export function setPendingApproval(
  set: ChatStoreSet,
  get: ChatStoreGet,
  conversationId: string,
  approval: PendingToolApproval | null,
): void {
  set((state) => {
    const pendingApprovals = { ...state.pendingApprovals };
    if (approval) pendingApprovals[conversationId] = approval;
    else delete pendingApprovals[conversationId];
    return { pendingApprovals };
  });
  mirrorCurrentStreamState(set, get);
}

export function bumpStreamEpoch(set: ChatStoreSet, conversationId: string): void {
  set((state) => ({
    streamEpochs: {
      ...state.streamEpochs,
      [conversationId]: (state.streamEpochs[conversationId] ?? 0) + 1,
    },
  }));
}

export function visibleForConversation(get: ChatStoreGet, conversationId: string): boolean {
  return get().currentConversationId === conversationId;
}
