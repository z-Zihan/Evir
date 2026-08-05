import { Bot, ClipboardList, MessageCircle, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InteractionMode } from "../core/providers/tool-registry";

interface ModeSwitcherProps {
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

const MODES: ReadonlyArray<{ mode: InteractionMode; icon: LucideIcon }> = [
  { mode: "ask", icon: MessageCircle },
  { mode: "plan", icon: ClipboardList },
  { mode: "agent", icon: Bot },
];

export function ModeSwitcher({ mode, onModeChange }: ModeSwitcherProps) {
  const { t } = useTranslation();

  return (
    <div className="mode-switcher">
      {MODES.map(({ mode: option, icon: Icon }) => (
        <button
          key={option}
          type="button"
          className={`mode-button${mode === option ? " active" : ""}`}
          title={t(`chat.modes.${option}Desc`)}
          aria-pressed={mode === option}
          onClick={() => onModeChange(option)}
        >
          <Icon size={14} aria-hidden="true" />
          <span>{t(`chat.modes.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}
