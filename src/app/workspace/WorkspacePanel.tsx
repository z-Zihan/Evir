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
import { ChangesTab } from "./ChangesTab";
import { OutputsTab } from "./OutputsTab";
import { FilesTab } from "./FilesTab";
import { PreviewTab } from "./PreviewTab";
import { BrowserTab } from "./BrowserTab";
import { getRuntime } from "../../runtime/use-runtime";

interface TabDefinition {
  id: WorkspaceTab;
  label: string;
  /** Project-scoped tabs are hidden in standalone chats (§54). */
  requiresProject: boolean;
  badge?: number | "dot" | undefined;
  /** i18n key for the badge's accessible count label (defaults to changes). */
  badgeLabelKey?: string | undefined;
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
  const root = useActiveWorkspaceRoot();
  const hasProject = root !== null;

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
    },
    { id: "files", label: t("workspace.files"), requiresProject: true },
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
    activeTab === "changes" || activeTab === "files" || activeTab === "outputs"
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
                    className="workspace-tab-badge"
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
        {effectiveTab === "browser" && <BrowserTab />}
      </div>
    </aside>
  );
}
