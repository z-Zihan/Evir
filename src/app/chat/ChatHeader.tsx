import { useTranslation } from "react-i18next";
import { PanelLeft, PanelRight } from "lucide-react";
import { Button, Tip } from "../../components/ui";
import { ModelSwitcher } from "../ModelSwitcher";
import type { ProviderRecord } from "../../core/storage/db";

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
  activeProvider: ProviderRecord | undefined;
  activeModelId: string | undefined;
  /** Bump to open the model picker programmatically (slash /model). */
  modelSwitchSignal: number;
  onModelSwitch: (provider: ProviderRecord) => void;
  onSwitchModel: (provider: ProviderRecord, modelId: string) => void;
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
  activeProvider,
  activeModelId,
  modelSwitchSignal,
  onModelSwitch,
  onSwitchModel,
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
          <span className="workspace-context truncate text-[10.5px] text-muted">
            {providerName ?? runtimeCaption}
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
        <ModelSwitcher
          activeProvider={activeProvider}
          activeModelId={activeModelId}
          openSignal={modelSwitchSignal}
          onSwitch={onModelSwitch}
          onSwitchModel={onSwitchModel}
        />
      </div>
    </header>
  );
}
