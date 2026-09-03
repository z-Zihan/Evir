import { useTranslation } from "react-i18next";
import { Crosshair, ListChecks } from "lucide-react";
import { Button, Tip } from "../components/ui";
import { cn } from "../components/ui/utils";
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
      <div
        className="mode-switcher mode-unavailable flex items-center gap-1.5 rounded-full border border-warning/35 bg-warning/[0.07] py-0.5 pr-0.5 pl-2.5 text-[11px] text-warning"
        role="group"
        aria-label={t("chat.modeLabel")}
      >
        <span className="mode-unavailable-copy">{t("chat.noToolCalling")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="mode-unavailable-action h-5.5 px-1.5 text-[11px] text-warning hover:text-foreground"
          onClick={onConfigureModel}
        >
          {t("chat.changeModel")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="mode-switcher flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
      aria-label={t("chat.modeLabel")}
    >
      {PROJECT_MODES.map(({ mode: candidate, labelKey, icon: Icon }) => (
        <Tip key={candidate} content={t(`chat.modes.${candidate}Desc`)}>
          <Button
            type="button"
            size="sm"
            aria-pressed={mode === candidate}
            variant="ghost"
            className={cn(
              "h-6 rounded-full px-2 text-[11px]",
              mode === candidate
                ? "active bg-primary/[0.1] font-semibold text-primary hover:bg-primary/[0.14] hover:text-primary"
                : "font-normal text-muted hover:text-foreground",
            )}
            onClick={() => onModeChange(mode === candidate ? "agent" : candidate)}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </Button>
        </Tip>
      ))}
    </div>
  );
}
