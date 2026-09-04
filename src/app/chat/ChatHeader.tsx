import { useTranslation } from "react-i18next";
import { PanelLeft, PanelRight } from "lucide-react";
import { Button, Tip } from "../../components/ui";
import type { ConversationRunStatus } from "../../features/chat/run-phase";

export interface ChatHeaderProps {
  title: string;
  /** Provider actually in use (may differ from default after in-chat switch). */
  providerName: string | undefined;
  /** Fallback caption when no provider is configured. */
  runtimeCaption: string;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  isDesktop: boolean;
  /** Canonical run phase for this thread (§68: title + status only). */
  runStatus: ConversationRunStatus | null;
}

/** Conversation header: sidebar/panel toggles, title and model switcher. */
export function ChatHeader({
  title,
  providerName,
  runtimeCaption,
  sidebarVisible,
  onToggleSidebar,
  panelOpen,
  onTogglePanel,
  isDesktop,
  runStatus,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="workspace-header flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <div className="workspace-heading flex min-w-0 items-center gap-1.5">
        <Tip content={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="header-icon-button"
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? t("sidebar.hide") : t("sidebar.show")}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </Button>
        </Tip>
        <div className="workspace-title-block flex min-w-0 flex-col leading-tight">
          <h1 className="truncate text-[13px] font-semibold text-foreground">{title}</h1>
          <span className="workspace-context flex min-w-0 items-center gap-1.5 truncate text-[10.5px] text-muted">
            {runStatus && (
              <span
                className={`header-run-status header-run-status-${runStatus} inline-flex shrink-0 items-center gap-1`}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                {t(
                  `sidebar.status${runStatus === "streaming" ? "Running" : statusLabelKey(runStatus)}`,
                )}
              </span>
            )}
            <span className="truncate">{providerName ?? runtimeCaption}</span>
          </span>
        </div>
      </div>
      <div className="workspace-controls flex shrink-0 items-center gap-1.5">
        {isDesktop && (
          <Tip content={panelOpen ? t("workspace.close") : t("workspace.open")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="header-icon-button workspace-toggle"
              onClick={onTogglePanel}
              aria-label={panelOpen ? t("workspace.close") : t("workspace.open")}
              aria-pressed={panelOpen}
            >
              <PanelRight size={17} aria-hidden="true" />
            </Button>
          </Tip>
        )}
      </div>
    </header>
  );
}

function statusLabelKey(status: ConversationRunStatus): string {
  switch (status) {
    case "preparing":
      return "Preparing";
    case "verifying":
      return "Verifying";
    case "approval":
      return "Approval";
    case "waiting-user":
      return "WaitingUser";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "unread":
      return "Unread";
    default:
      return "Running";
  }
}
