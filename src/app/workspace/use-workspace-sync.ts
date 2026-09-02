import { useEffect, useRef } from "react";
import { useChatStore } from "../../features/chat/chat-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";

/**
 * Bridges chat state into the workspace panel:
 * - latestAgentRun (loaded on conversation open / set at run end) hydrates
 *   the changes/outputs mirror from the persisted record;
 * - switching conversations saves and restores the per-thread panel state
 *   so Project A's preview never leaks into Project B (§53).
 */
export function useWorkspaceSync(currentConversationId: string | null | undefined): void {
  const latestAgentRun = useChatStore((state) => state.latestAgentRun);
  const previousConversationRef = useRef<string | null>(null);

  useEffect(() => {
    const runWorkspace = useRunWorkspaceStore.getState();
    // The flat run-view fields must always describe the conversation on
    // screen — including a live background run that kept updating its entry
    // while the user was elsewhere.
    runWorkspace.setViewedConversation(currentConversationId ?? null);
  }, [currentConversationId]);

  useEffect(() => {
    const panel = useWorkspacePanelStore.getState();
    const previous = previousConversationRef.current;
    if (previous && previous !== currentConversationId) {
      panel.saveConversationState(previous);
    }
    if (currentConversationId && previous !== currentConversationId) {
      panel.restoreConversationState(currentConversationId);
    }
    previousConversationRef.current = currentConversationId ?? null;
  }, [currentConversationId]);

  useEffect(() => {
    if (!latestAgentRun) return;
    const runWorkspace = useRunWorkspaceStore.getState();
    // Re-derive from the persisted record: covers conversation reload and
    // replaces the incremental live state once the run completes.
    runWorkspace.hydrate(latestAgentRun);
  }, [latestAgentRun, latestAgentRun?.updatedAt]);
}
