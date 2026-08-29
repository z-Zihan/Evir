import { useTranslation } from "react-i18next";
import { Crosshair, ListChecks } from "lucide-react";
import type { InteractionMode } from "../core/providers/tool-registry";

interface ModeSwitcherProps {
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  /** Project threads (or the legacy workspace) can run the special plan/goal modes. */
  projectScoped: boolean;
  toolCalling: boolean;
  onConfigureModel: () => void;
}

const PROJECT_MODES: ReadonlyArray<{
  mode: Extract<InteractionMode, "plan" | "goal">;
  labelKey: string;
  icon: typeof ListChecks;
}> = [
  { mode: "plan", labelKey: "chat.modes.plan", icon: ListChecks },
  { mode: "goal", labelKey: "chat.modes.goal", icon: Crosshair },
];

/**
 * Project tasks use Agent behavior by default, so only the explicit special
 * modes are visible. Pressing the selected special mode returns to the default
 * project task. Standalone chats are always ask-mode and render nothing.
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
          onClick={() => onModeChange(mode === candidate ? "agent" : candidate)}
          data-tip={t(`chat.modes.${candidate}Desc`)}
        >
          <Icon size={13} aria-hidden="true" />
          <span>{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
