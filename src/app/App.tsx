import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderStore } from "../features/provider/provider-store";
import { useUsageStore } from "../features/usage/usage-store";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
const SettingsModal = lazy(() =>
  import("./SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
import type { SettingsTab } from "./SettingsModal";
import { useShortcuts } from "./useShortcuts";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { WorkspacePanel } from "./workspace/WorkspacePanel";
import { useWorkspaceSync } from "./workspace/use-workspace-sync";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { initializeRuntimeStorage } from "../runtime/initialize-storage";
import { installWorkspaceResolver } from "../features/workspace/workspace-bridge";
import { useProjectStore } from "../features/projects/project-store";
import { useChatStore } from "../features/chat/chat-store";
import {
  clearCheckpoint,
  findUnfinishedRuns,
  type UnfinishedRun,
} from "../core/context/crash-recovery";
import { getRuntime } from "../runtime/use-runtime";
import { logger } from "../core/logging/logger";
import {
  Button,
  ResizableGroup,
  ResizableHandle,
  ResizablePanel,
  TooltipProvider,
  useDefaultLayout,
} from "../components/ui";
import {
  CHAT_PANEL_ID,
  CONVERSATION_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_OVERLAY_QUERY,
  SHELL_LAYOUT_STORAGE_ID,
  SIDEBAR_PANEL_ID,
  WORKSPACE_DEFAULT_WIDTH,
  WORKSPACE_DRAWER_QUERY,
  WORKSPACE_MIN_WIDTH,
  WORKSPACE_PANEL_ID,
  createShellLayoutStorage,
} from "./shell-layout";
import { useMediaQuery } from "./useMediaQuery";

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

  const dismissRecovery = async (run: UnfinishedRun) => {
    await clearCheckpoint(run.conversationId);
    setUnfinishedRuns((runs) => runs.filter((item) => item.conversationId !== run.conversationId));
  };

  const resumeRecovery = async (run: UnfinishedRun) => {
    await selectConversation(run.conversationId);
    await dismissRecovery(run);
    window.dispatchEvent(new Event("evir:focus-composer"));
  };

  // Drawer breakpoints (CSS mirrors live in shell.css). Below 820px the
  // sidebar becomes a fixed overlay drawer; below 1440px an open workspace
  // becomes a fixed right drawer. Affected columns render outside the Group.
  const sidebarOverlay = useMediaQuery(SIDEBAR_OVERLAY_QUERY);
  const workspaceDrawer = useMediaQuery(WORKSPACE_DRAWER_QUERY);

  // Entering the compact viewport closes the sidebar, leaving it reopens it
  // (same behavior the old matchMedia handler provided).
  const previousSidebarOverlay = useRef(sidebarOverlay);
  useEffect(() => {
    if (previousSidebarOverlay.current === sidebarOverlay) return;
    previousSidebarOverlay.current = sidebarOverlay;
    setSidebarVisible(!sidebarOverlay);
  }, [sidebarOverlay]);

  // Workspace panel: third column with persisted width + per-thread state.
  const workspaceStoreOpen = useWorkspacePanelStore((state) => state.open);
  const workspaceOpen = workspaceAvailable && workspaceStoreOpen;
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  useWorkspaceSync(currentConversationId);

  // Columns laid out by the resizable Group; drawer variants render after it
  // as fixed overlays and must not join the Group's flex layout.
  const sidebarInFlow = sidebarVisible && !sidebarOverlay;
  const workspaceInFlow = workspaceOpen && !workspaceDrawer;

  const panelIds = useMemo(
    () => [
      ...(sidebarInFlow ? [SIDEBAR_PANEL_ID] : []),
      CHAT_PANEL_ID,
      ...(workspaceInFlow ? [WORKSPACE_PANEL_ID] : []),
    ],
    [sidebarInFlow, workspaceInFlow],
  );

  // One persisted layout per visible-panel composition; the storage adapter
  // migrates the legacy `evir-*-width` px keys on first read (shell-layout.ts).
  const shellStorage = useMemo(() => createShellLayoutStorage(window.localStorage), []);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: SHELL_LAYOUT_STORAGE_ID,
    panelIds,
    storage: shellStorage,
  });

  // Full-screen overlays register themselves via useOverlayBrowserGuard so
  // the native browser webviews hide while any of them is open.

  const shellClass =
    `app-shell${sidebarVisible ? " sidebar-visible" : ""}` +
    `${workspaceOpen ? " workspace-visible" : ""}`;

  const sidebar = (
    <Sidebar
      onOpenSettings={openSettings}
      onNewConversation={handleNewConversation}
      onClose={() => setSidebarVisible(false)}
    />
  );

  return (
    <TooltipProvider>
      <div className={shellClass}>
        <ResizableGroup
          /* Remount per composition so the persisted layout for exactly these
           * panels is applied on mount (defaultLayout is only read on mount). */
          key={panelIds.join("+")}
          id={SHELL_LAYOUT_STORAGE_ID}
          className="shell-columns"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          {sidebarInFlow && (
            <ResizablePanel
              id={SIDEBAR_PANEL_ID}
              defaultSize={SIDEBAR_DEFAULT_WIDTH}
              minSize={SIDEBAR_MIN_WIDTH}
              maxSize={SIDEBAR_MAX_WIDTH}
              groupResizeBehavior="preserve-pixel-size"
            >
              {sidebar}
            </ResizablePanel>
          )}
          {sidebarInFlow && (
            <ResizableHandle
              /* Legacy hook class kept for e2e/test selectors. */
              className="sidebar-resizer"
              aria-label={t("sidebar.resize")}
            />
          )}
          <ResizablePanel id={CHAT_PANEL_ID} minSize={CONVERSATION_MIN_WIDTH}>
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
          </ResizablePanel>
          {workspaceInFlow && (
            <ResizableHandle className="workspace-resizer" aria-label={t("workspace.resize")} />
          )}
          {workspaceInFlow && (
            <ResizablePanel
              id={WORKSPACE_PANEL_ID}
              defaultSize={WORKSPACE_DEFAULT_WIDTH}
              minSize={WORKSPACE_MIN_WIDTH}
              maxSize="70vw"
              groupResizeBehavior="preserve-pixel-size"
            >
              <WorkspacePanel />
            </ResizablePanel>
          )}
        </ResizableGroup>
        {sidebarVisible && sidebarOverlay && (
          <>
            <button
              className="sidebar-backdrop"
              type="button"
              aria-label={t("sidebar.hide")}
              onClick={() => setSidebarVisible(false)}
            />
            {sidebar}
          </>
        )}
        {workspaceOpen && workspaceDrawer && (
          <>
            <div
              className="workspace-backdrop"
              onClick={() => useWorkspacePanelStore.getState().closePanel()}
            />
            <WorkspacePanel />
          </>
        )}
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
