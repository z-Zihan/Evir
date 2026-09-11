import { useEffect, useRef } from "react";
import { useChatStore } from "../../features/chat/chat-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";
import {
  markWorkbenchClosedForProject,
  markWorkbenchReopenedForProject,
  readClosedWorkbenchProjects,
} from "../../features/workspace/workbench-preference";
import { getRuntime } from "../../runtime/use-runtime";

/**
 * Bridges chat state into the workspace panel:
 * - latestAgentRun (loaded on conversation open / set at run end) hydrates
 *   the changes/outputs mirror from the persisted record;
 * - switching conversations saves and restores the per-thread panel state
 *   so Project A's preview never leaks into Project B (§53);
 * - a fresh project thread presents the workbench (Changes tab) by default,
 *   unless the user has explicitly closed it for that project (§30b) —
 *   standalone chats never open the workbench.
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
      const conversation = useChatStore
        .getState()
        .conversations.find((entry) => entry.id === currentConversationId);
      const projectId = conversation?.projectId ?? null;
      // Workbench-by-default is a desktop, project-thread behavior only.
      const defaultTab =
        getRuntime().target === "desktop" &&
        projectId !== null &&
        !readClosedWorkbenchProjects().has(projectId)
          ? ("changes" as const)
          : undefined;
      panel.restoreConversationState(
        currentConversationId,
        defaultTab ? { defaultTab } : undefined,
      );
    }
    previousConversationRef.current = currentConversationId ?? null;
  }, [currentConversationId]);

  // Explicit open/close while a project thread is on screen adjusts that
  // project's workbench preference, so a one-off close is respected on the
  // next thread instead of the panel popping open again.
  useEffect(() => {
    const projectIdOf = () => {
      const conversation = useChatStore
        .getState()
        .conversations.find((entry) => entry.id === currentConversationId);
      return conversation?.projectId ?? null;
    };
    return useWorkspacePanelStore.subscribe((state, previous) => {
      if (state.open === previous.open) return;
      const projectId = projectIdOf();
      if (!projectId) return;
      if (state.open) markWorkbenchReopenedForProject(projectId);
      else markWorkbenchClosedForProject(projectId);
    });
  }, [currentConversationId]);

  useEffect(() => {
    if (!latestAgentRun) return;
    const runWorkspace = useRunWorkspaceStore.getState();
    // Re-derive from the persisted record: covers conversation reload and
    // replaces the incremental live state once the run completes.
    runWorkspace.hydrate(latestAgentRun);
  }, [latestAgentRun, latestAgentRun?.updatedAt]);
}
