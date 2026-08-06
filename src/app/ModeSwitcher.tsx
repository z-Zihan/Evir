import { Bot, MessageCircle, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InteractionMode } from "../core/providers/tool-registry";
import { getRuntime } from "../runtime/use-runtime";

interface ModeSwitcherProps {
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

const DESKTOP_MODES: ReadonlyArray<{ mode: InteractionMode; icon: LucideIcon }> = [
  { mode: "ask", icon: MessageCircle },
  { mode: "agent", icon: Bot },
];

export function ModeSwitcher({ mode, onModeChange }: ModeSwitcherProps) {
  const { t } = useTranslation();
  const runtime = getRuntime();

  // Web only gets "ask" — no agent/plan modes
  const modes =
    runtime.target === "desktop"
      ? DESKTOP_MODES
      : [{ mode: "ask" as InteractionMode, icon: MessageCircle }];

  // If current mode not available, fall back to ask
  const effectiveMode = modes.some((m) => m.mode === mode) ? mode : "ask";

  return (
    <div className="flex gap-0.5 p-0.5 border border-border rounded-lg bg-surface">
      {modes.map(({ mode: option, icon: Icon }) => (
        <button
          key={option}
          type="button"
          className={`px-2.5 py-1 rounded text-xs font-medium transition border-0 ${
            effectiveMode === option
              ? "bg-primary text-primary-fg"
              : "bg-transparent text-muted hover:text-foreground"
          }`}
          title={t(`chat.modes.${option}Desc`)}
          aria-pressed={effectiveMode === option}
          onClick={() => onModeChange(option)}
        >
          <Icon size={14} aria-hidden="true" />
          <span>{t(`chat.modes.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}
