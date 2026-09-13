import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button, Tabs, TabsListUnderline, TabsTabUnderline, Tip } from "../../components/ui";
import {
  useWorkspacePanelStore,
  type WorkspaceTab,
} from "../../features/workspace/workspace-panel-store";
import { useRunWorkspaceStore } from "../../features/workspace/workspace-run-store";
import { useChatStore } from "../../features/chat/chat-store";
import { useActiveWorkspaceRoot } from "../../features/workspace/workspace-bridge";
import { subscribeWorkspaceToolEvents } from "../../features/workspace/workspace-events";
import { desktopStorage } from "../../runtime/desktop-storage-adapter";
import { isCanvasToolName, resolveCanvasToolPath } from "../../features/canvas/canvas-path";
import { ChangesTab } from "./ChangesTab";
import { OutputsTab } from "./OutputsTab";
import { FilesTab } from "./FilesTab";
import { PreviewTab } from "./PreviewTab";
import { BrowserTab } from "./BrowserTab";
import { CanvasTab } from "./CanvasTab";
import { getRuntime } from "../../runtime/use-runtime";

/**
 * §29: while a run mutates files, the changes tab takes over the panel
 * unless the user is locked onto preview/browser (badge accrues instead).
 * The watcher lives here — before the desktop/open early return — so it
 * keeps running while the panel is closed too.
 */
function useChangesAutoFocus() {
  const changesCount = useRunWorkspaceStore((state) => state.changes.length);
  const previous = useRef(changesCount);
  useEffect(() => {
    if (changesCount > previous.current) {
      useWorkspacePanelStore.getState().noteRunChanges(changesCount);
    }
    previous.current = changesCount;
  }, [changesCount]);
}

/**
 * CAN-2: the canvas tab exists when the project has a `.evir-canvas`
 * document (detected once per root) or the agent just wrote one; a
 * successful agent canvas write focuses the tab under §29 rules.
 */
function useCanvasTabPresence(root: string | null) {
  const canvasPath = useWorkspacePanelStore((state) => state.canvasPath);
  const [projectHasCanvas, setProjectHasCanvas] = useState(false);

  useEffect(() => {
    setProjectHasCanvas(false);
    if (!root) return;
    let cancelled = false;
    void desktopStorage
      .searchFiles(root, ".evir-canvas")
      .then((paths) => {
        if (cancelled) return;
        setProjectHasCanvas(paths.some((path) => path.toLowerCase().endsWith(".evir-canvas")));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [root]);

  useEffect(() => {
    return subscribeWorkspaceToolEvents((event) => {
      if (!event.result.success || !isCanvasToolName(event.toolCall.toolName)) return;
      const resolved = resolveCanvasToolPath(event.toolCall.arguments, root);
      if (resolved) useWorkspacePanelStore.getState().noteCanvasWrite(resolved);
    });
  }, [root]);

  return canvasPath !== null || projectHasCanvas;
}

interface TabDefinition {
  id: WorkspaceTab;
  label: string;
  /** Project-scoped tabs are hidden in standalone chats (§54). */
  requiresProject: boolean;
  badge?: number | "dot" | undefined;
  /** i18n key for the badge's accessible count label (defaults to changes). */
  badgeLabelKey?: string | undefined;
  /** True when unseen changes accrued while another tab held the focus. */
  attention?: boolean | undefined;
  /** Default true; the canvas tab appears only when a canvas exists. */
  visible?: boolean | undefined;
}

/**
 * The workspace panel: the third column that answers "what is the agent
 * working on". Tabs (Changes / Files / Preview / Browser) sit above the
 * resource content; project tabs disappear without a project root.
 */
export function WorkspacePanel() {
  const { t } = useTranslation();
  const open = useWorkspacePanelStore((state) => state.open);
  const activeTab = useWorkspacePanelStore((state) => state.activeTab);
  const setTab = useWorkspacePanelStore((state) => state.setTab);
  const closePanel = useWorkspacePanelStore((state) => state.closePanel);
  const changesCount = useRunWorkspaceStore((state) => state.changes.length);
  const outputsCount = useRunWorkspaceStore((state) => state.outputs.length);
  const browserActive = useRunWorkspaceStore((state) => state.browserActive);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const changesBadge = useWorkspacePanelStore((state) => state.changesBadge);
  const root = useActiveWorkspaceRoot();
  const hasProject = root !== null;
  useChangesAutoFocus();
  const hasCanvas = useCanvasTabPresence(root);

  if (getRuntime().target !== "desktop" || !open) return null;

  const tabs: TabDefinition[] = [
    {
      id: "outputs",
      label: t("workspace.outputs"),
      requiresProject: true,
      badge: outputsCount,
      badgeLabelKey: "workspace.outputsCount",
    },
    {
      id: "changes",
      label: t("workspace.changes"),
      requiresProject: true,
      badge: changesCount,
      badgeLabelKey: "workspace.changesCount",
      /** Unseen changes while the user holds another context get emphasis. */
      attention: changesBadge > 0 && activeTab !== "changes",
    },
    { id: "files", label: t("workspace.files"), requiresProject: true },
    {
      id: "canvas",
      label: t("workspace.canvasTab"),
      requiresProject: true,
      /** Hidden until a canvas exists in the project (CAN-2). */
      visible: hasCanvas,
    },
    {
      id: "preview",
      label: t("workspace.preview"),
      requiresProject: false,
      badge: isStreaming && browserActive ? "dot" : undefined,
    },
    {
      id: "browser",
      label: t("workspace.browser"),
      requiresProject: false,
      badge: isStreaming && browserActive ? "dot" : undefined,
    },
  ];
  const effectiveTab =
    activeTab === "changes" ||
    activeTab === "files" ||
    activeTab === "outputs" ||
    activeTab === "canvas"
      ? hasProject
        ? activeTab
        : "preview"
      : activeTab;

  return (
    <aside className="workspace-panel" aria-label={t("workspace.title")}>
      {/* Tabs owns only the tab row: the content area stays a plain sibling so
          the panel's flex column layout and lazy per-tab mounting are kept. */}
      <Tabs value={effectiveTab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
        <TabsListUnderline className="workspace-panel-tabs" aria-label={t("workspace.title")}>
          {tabs
            .filter((tab) => !tab.requiresProject || hasProject)
            .map((tab) => (
              <TabsTabUnderline
                key={tab.id}
                id={`workspace-tab-${tab.id}`}
                value={tab.id}
                className={`workspace-panel-tab${effectiveTab === tab.id ? " active" : ""}`}
                aria-controls="workspace-panel-content"
              >
                <span>{tab.label}</span>
                {typeof tab.badge === "number" && tab.badge > 0 && (
                  <span
                    className={`workspace-tab-badge${tab.attention ? " attention" : ""}`}
                    aria-label={t(tab.badgeLabelKey ?? "workspace.changesCount", {
                      count: tab.badge,
                    })}
                  >
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                )}
                {tab.badge === "dot" && <span className="workspace-tab-dot" aria-hidden="true" />}
              </TabsTabUnderline>
            ))}
          <Tip content={t("workspace.close")} side="bottom">
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              onClick={closePanel}
              aria-label={t("workspace.close")}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </Tip>
        </TabsListUnderline>
      </Tabs>
      <div
        className="workspace-panel-content"
        id="workspace-panel-content"
        role="tabpanel"
        aria-labelledby={`workspace-tab-${effectiveTab}`}
      >
        {effectiveTab === "outputs" && <OutputsTab />}
        {effectiveTab === "changes" && <ChangesTab />}
        {effectiveTab === "files" && <FilesTab />}
        {effectiveTab === "preview" && <PreviewTab />}
        {effectiveTab === "canvas" && <CanvasTab />}
        {effectiveTab === "browser" && <BrowserTab />}
      </div>
    </aside>
  );
}
