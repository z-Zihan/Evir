import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderStore } from "../features/provider/provider-store";
import { useUsageStore } from "../features/usage/usage-store";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { SettingsModal, type SettingsTab } from "./SettingsModal";
import { useShortcuts } from "./useShortcuts";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { WorkspacePanel } from "./workspace/WorkspacePanel";
import { useWorkspaceResize } from "./workspace/useWorkspaceResize";
import { useWorkspaceSync } from "./workspace/use-workspace-sync";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { initializeRuntimeStorage } from "../runtime/initialize-storage";
import { installWorkspaceResolver } from "../features/workspace/workspace-bridge";
import { useSidebarResize } from "./useSidebarResize";
import { useProjectStore } from "../features/projects/project-store";
import { useChatStore } from "../features/chat/chat-store";
import {
  clearCheckpoint,
  findUnfinishedRuns,
  type UnfinishedRun,
} from "../core/context/crash-recovery";
import { getRuntime } from "../runtime/use-runtime";
import { logger } from "../core/logging/logger";
import { Button, TooltipProvider } from "../components/ui";

export function App() {
  const { t } = useTranslation();
  const workspaceAvailable = getRuntime().target === "desktop";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(
    () => typeof window === "undefined" || window.innerWidth > 820,
  );
  const [messageInput, setMessageInput] = useState("");
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [unfinishedRuns, setUnfinishedRuns] = useState<UnfinishedRun[]>([]);
  // Field selectors: a whole-store subscription here would re-render the
  // entire app (including the sidebar tree) on every streaming delta.
  const loadProviders = useProviderStore((state) => state.loadProviders);
  const getDefaultProvider = useProviderStore((state) => state.getDefaultProvider);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const createOrReuseConversation = useChatStore((state) => state.createOrReuseConversation);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const stopGeneration = useChatStore((state) => state.stopGeneration);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const loadUsageRecords = useUsageStore((state) => state.loadRecords);
  const loadProjects = useProjectStore((state) => state.load);

  const handleNewConversation = useCallback(() => {
    const provider = getDefaultProvider();
    if (!provider) {
      setSettingsTab("providers");
      setSettingsOpen(true);
      return;
    }
    const focusComposer = () => window.dispatchEvent(new Event("evir:focus-composer"));
    void createOrReuseConversation(provider.id, provider.modelId).then(focusComposer);
  }, [createOrReuseConversation, getDefaultProvider]);

  const openSettings = useCallback((tab: SettingsTab = "providers") => {
    logger.info("ui", "ui.open", {
      actionId: crypto.randomUUID(),
      surface: "settings",
      tab,
    });
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleSendMessage = useCallback(() => {
    // Busy checks live in the store (per-conversation): another conversation
    // running in the background must not block this one's composer.
    if (!messageInput.trim()) return;
    // Clear the draft only after the message is accepted (persisted or
    // private-accepted); on pre-acceptance failure the draft stays editable
    // and the chat-error line explains the failure.
    void sendMessage(messageInput, () => setMessageInput("")).catch(() => {
      /* error surfaced via chat error line; draft preserved */
    });
  }, [messageInput, sendMessage]);

  useShortcuts({
    onShortcutHelp: () => setShortcutHelpOpen(true),
    onNewConversation: handleNewConversation,
    onOpenSettings: () => openSettings(),
    onToggleSidebar: () => setSidebarVisible((visible) => !visible),
    onSendMessage: handleSendMessage,
    onStop: () => {
      if (isStreaming) stopGeneration();
    },
  });

  const initializeApplication = useCallback(async () => {
    setInitializationError(null);
    try {
      await initializeRuntimeStorage();
      installWorkspaceResolver();
      await Promise.all([loadProviders(), loadConversations(), loadUsageRecords(), loadProjects()]);
      setUnfinishedRuns(await findUnfinishedRuns());
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : String(error));
    }
  }, [loadProviders, loadConversations, loadUsageRecords, loadProjects]);

  useEffect(() => {
    void initializeApplication();
  }, [initializeApplication]);

  const sidebarResize = useSidebarResize();

  const dismissRecovery = async (run: UnfinishedRun) => {
    await clearCheckpoint(run.conversationId);
    setUnfinishedRuns((runs) => runs.filter((item) => item.conversationId !== run.conversationId));
  };

  const resumeRecovery = async (run: UnfinishedRun) => {
    await selectConversation(run.conversationId);
    await dismissRecovery(run);
    window.dispatchEvent(new Event("evir:focus-composer"));
  };

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compact = window.matchMedia("(max-width: 820px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setSidebarVisible(!event.matches);
    };
    compact.addEventListener("change", handleViewportChange);
    return () => compact.removeEventListener("change", handleViewportChange);
  }, []);

  // Workspace panel: third column with persisted width + per-thread state.
  const workspaceResize = useWorkspaceResize();
  const workspaceStoreOpen = useWorkspacePanelStore((state) => state.open);
  const workspaceOpen = workspaceAvailable && workspaceStoreOpen;
  const workspaceWidth = useWorkspacePanelStore((state) => state.width);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  useWorkspaceSync(currentConversationId);

  // Full-screen overlays register themselves via useOverlayBrowserGuard so
  // the native browser webviews hide while any of them is open.

  const shellClass =
    `app-shell${sidebarVisible ? " sidebar-visible" : ""}` +
    `${sidebarResize.resizing ? " sidebar-resizing" : ""}` +
    `${workspaceOpen ? " workspace-visible" : ""}` +
    `${workspaceResize.resizing ? " workspace-resizing" : ""}`;

  return (
    <TooltipProvider>
      <div
        className={shellClass}
        style={{
          ...(sidebarVisible
            ? ({ "--sidebar-width": `${sidebarResize.width}px` } as React.CSSProperties)
            : {}),
          ...(workspaceOpen
            ? ({ "--workspace-width": `${workspaceWidth}px` } as React.CSSProperties)
            : {}),
        }}
      >
        {sidebarVisible && (
          <Sidebar
            onOpenSettings={openSettings}
            onNewConversation={handleNewConversation}
            onClose={() => setSidebarVisible(false)}
          />
        )}
        {sidebarVisible && (
          <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("sidebar.resize")}
            onPointerDown={sidebarResize.handleProps.onPointerDown}
            ref={sidebarResize.handleProps.ref}
            onDoubleClick={sidebarResize.reset}
          />
        )}
        {sidebarVisible && (
          <button
            className="sidebar-backdrop"
            type="button"
            aria-label={t("sidebar.hide")}
            onClick={() => setSidebarVisible(false)}
          />
        )}
        <div className="main-area">
          <ChatView
            input={messageInput}
            onInputChange={setMessageInput}
            onSendMessage={handleSendMessage}
            onOpenSettings={() => openSettings()}
            onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
            sidebarVisible={sidebarVisible}
          />
        </div>
        {workspaceOpen && (
          <div
            className="workspace-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("workspace.resize")}
            onPointerDown={workspaceResize.handleProps.onPointerDown}
            onDoubleClick={workspaceResize.reset}
          />
        )}
        {workspaceOpen && (
          <div
            className="workspace-backdrop"
            onClick={() => useWorkspacePanelStore.getState().closePanel()}
          />
        )}
        {workspaceAvailable && <WorkspacePanel />}
        <SettingsModal
          open={settingsOpen}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
        />
        <ShortcutHelpOverlay open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
        {initializationError && (
          <aside className="startup-notice error" role="alert">
            <div>
              <strong>{t("startup.failed")}</strong>
              <span>{initializationError}</span>
            </div>
            <button type="button" onClick={() => void initializeApplication()}>
              {t("startup.retry")}
            </button>
          </aside>
        )}
        {unfinishedRuns[0] && !initializationError && (
          <aside className="startup-notice recovery" role="status">
            <div>
              <strong>{t("recovery.title")}</strong>
              <span>{t("recovery.description")}</span>
            </div>
            <div className="startup-notice-actions">
              <button type="button" onClick={() => void dismissRecovery(unfinishedRuns[0]!)}>
                {t("recovery.dismiss")}
              </button>
              <Button
                variant="primary"
                size="lg"
                type="button"
                className="primary-button"
                onClick={() => void resumeRecovery(unfinishedRuns[0]!)}
              >
                {t("recovery.resume")}
              </Button>
            </div>
          </aside>
        )}
      </div>
    </TooltipProvider>
  );
}
