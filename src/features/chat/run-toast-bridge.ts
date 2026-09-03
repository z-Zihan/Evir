import { logger } from "../../core/logging/logger";
import { notify } from "../../components/feedback";
import i18n from "../../i18n/config";
import { useChatStore } from "./chat-store";

/**
 * Lightweight in-app toast bridge for background runs (§19): when a
 * conversation the user is NOT looking at completes, fails, or starts waiting
 * for approval, raise one low-noise toast. The sidebar badge remains the
 * primary status surface; toasts never fire for the active conversation.
 */

const seenOutcomeKeys = new Set<string>();
const seenApprovalIds = new Set<string>();

function isBackground(conversationId: string): boolean {
  return useChatStore.getState().currentConversationId !== conversationId;
}

let unsubscribe: (() => void) | null = null;

export function startRunToastBridge(): void {
  if (unsubscribe) return;
  const check = ({
    runOutcomes,
    pendingApprovals,
  }: {
    runOutcomes: Record<string, { status: "completed" | "failed" | "stopped"; at: number }>;
    pendingApprovals: Record<string, { toolCallId: string; toolName: string }>;
  }) => {
    for (const [conversationId, outcome] of Object.entries(runOutcomes)) {
      const key = `${conversationId}:${outcome.at}`;
      if (seenOutcomeKeys.has(key)) continue;
      seenOutcomeKeys.add(key);
      if (seenOutcomeKeys.size > 200) seenOutcomeKeys.clear();
      if (!isBackground(conversationId)) continue;
      if (outcome.status === "completed" || outcome.status === "failed") {
        const description = useChatStore
          .getState()
          .conversations.find(({ id }) => id === conversationId)?.title;
        if (outcome.status === "completed") {
          notify.success(i18n.t("toast.runCompleted"), { description });
        } else {
          notify.error(i18n.t("toast.runFailed"), { description });
        }
      }
    }
    for (const [conversationId, pending] of Object.entries(pendingApprovals)) {
      if (seenApprovalIds.has(pending.toolCallId)) continue;
      seenApprovalIds.add(pending.toolCallId);
      if (seenApprovalIds.size > 200) seenApprovalIds.clear();
      if (!isBackground(conversationId)) continue;
      notify.warning(i18n.t("toast.approvalRequired"), { description: pending.toolName });
    }
  };
  check(useChatStore.getState());
  unsubscribe = useChatStore.subscribe((state, previous) => {
    if (
      state.runOutcomes !== previous.runOutcomes ||
      state.pendingApprovals !== previous.pendingApprovals
    ) {
      check(state);
    }
  });
  logger.info("ui", "ui.toast-bridge.started", {});
}

export function stopRunToastBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
