import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../features/chat/chat-store";

export type ConversationRunStatus = "preparing" | "streaming" | "approval" | "failed" | "unread";

/**
 * Live per-conversation run status for sidebar rows. The selectors project
 * ONLY status-relevant data (slot phases, approval keys, failure keys), so
 * streaming content deltas never re-render the sidebar tree — the projections
 * are stable strings compared with useShallow.
 */
export interface ConversationStatusIndex {
  slotPhase: Record<string, "preparing" | "streaming">;
  approvals: Set<string>;
  failures: Set<string>;
  /** Resolves the effective status for one conversation row. */
  statusOf(conversationId: string, updatedAt: number): ConversationRunStatus | null;
}

export function useConversationStatusIndex(): ConversationStatusIndex {
  // Project to primitive strings: content-only slot changes keep the same
  // projection and useShallow skips the re-render.
  const slotProjection = useChatStore(
    useShallow((state) =>
      Object.entries(state.streamSlots ?? {}).map(([id, slot]) => `${id}:${slot.phase}`),
    ),
  );
  const approvalKeys = useChatStore(
    useShallow((state) => Object.keys(state.pendingApprovals ?? {}).sort()),
  );
  const failureKeys = useChatStore(
    useShallow((state) =>
      Object.entries(state.runOutcomes ?? {})
        .filter(([, outcome]) => outcome.status === "failed")
        .map(([id]) => id)
        .sort(),
    ),
  );
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);

  return useMemo(() => {
    const slotPhase: Record<string, "preparing" | "streaming"> = {};
    for (const entry of slotProjection) {
      const separator = entry.lastIndexOf(":");
      slotPhase[entry.slice(0, separator)] = entry.slice(separator + 1) as
        "preparing" | "streaming";
    }
    const approvals = new Set(approvalKeys);
    const failures = new Set(failureKeys);
    const statusOf = (conversationId: string, updatedAt: number): ConversationRunStatus | null => {
      if (approvals.has(conversationId)) return "approval";
      const phase = slotPhase[conversationId];
      if (phase) return phase;
      if (failures.has(conversationId)) return "failed";
      // Unread: results landed after the conversation was last viewed and it
      // is not the one on screen right now.
      if (
        conversationId !== currentConversationId &&
        conversationUpdatedAfterViewed(conversations, conversationId, updatedAt)
      ) {
        return "unread";
      }
      return null;
    };
    return { slotPhase, approvals, failures, statusOf };
  }, [slotProjection, approvalKeys, failureKeys, conversations, currentConversationId]);
}

function conversationUpdatedAfterViewed(
  conversations: { id: string; updatedAt: number }[],
  conversationId: string,
  updatedAt: number,
): boolean {
  // `updatedAt` comes from the row's own record; viewedAt is read fresh from
  // the store so this helper stays pure per render. Conversations without a
  // viewedAt entry (never interacted with this session) count as seen — no
  // unread storm on a fresh launch.
  const viewedAt = useChatStore.getState().conversationViewedAt?.[conversationId];
  return viewedAt !== undefined && updatedAt > viewedAt;
}
