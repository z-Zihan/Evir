import { useTranslation } from "react-i18next";
import { Bot, Crosshair, ListChecks } from "lucide-react";
import type { InteractionMode } from "../core/providers/tool-registry";

interface ModeSwitcherProps {
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  /** Project threads (or the legacy workspace) can run agent/plan/goal. */
  projectScoped: boolean;
  toolCalling: boolean;
  onConfigureModel: () => void;
}

const PROJECT_MODES: ReadonlyArray<{
  mode: Exclude<InteractionMode, "ask">;
  labelKey: string;
  icon: typeof Bot;
}> = [
  { mode: "agent", labelKey: "chat.modes.agent", icon: Bot },
  { mode: "plan", labelKey: "chat.modes.plan", icon: ListChecks },
  { mode: "goal", labelKey: "chat.modes.goal", icon: Crosshair },
];

/**
 * Compact mode control inside the composer for project threads. Standalone
 * chats are always ask-mode and render nothing. Without tool calling the
 * whole group is disabled with an actionable reason instead of failing after
 * the run starts.
 */
export function ModeSwitcher({
  mode,
  onModeChange,
  projectScoped,
  toolCalling,
  onConfigureModel,
}: ModeSwitcherProps) {
  const { t } = useTranslation();
  if (!projectScoped) return null;

  if (!toolCalling) {
    return (
      <div className="mode-switcher mode-unavailable" role="group" aria-label={t("chat.modeLabel")}>
        <span className="mode-unavailable-copy">{t("chat.noToolCalling")}</span>
        <button type="button" className="mode-unavailable-action" onClick={onConfigureModel}>
          {t("chat.changeModel")}
        </button>
      </div>
    );
  }

  return (
    <div className="mode-switcher" aria-label={t("chat.modeLabel")}>
      {PROJECT_MODES.map(({ mode: candidate, labelKey, icon: Icon }) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={mode === candidate}
          className={mode === candidate ? "active" : ""}
          onClick={() => onModeChange(candidate)}
          title={t(`chat.modes.${candidate}Desc`)}
        >
          <Icon size={13} aria-hidden="true" />
          <span>{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
