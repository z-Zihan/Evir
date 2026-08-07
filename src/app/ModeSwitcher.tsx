import { Bot, MessageCircle, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InteractionMode } from "../core/providers/tool-registry";
import { getRuntime } from "../runtime/use-runtime";
import { useProviderStore } from "../features/provider/provider-store";

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
  const provider = useProviderStore((state) => state.getDefaultProvider());
  const agentAvailable = provider === undefined || provider.modelCapabilities?.toolCalling === true;

  // Web only gets "ask" — no agent/plan modes
  const modes =
    runtime.target === "desktop"
      ? DESKTOP_MODES.filter(({ mode }) => mode !== "agent" || agentAvailable)
      : [{ mode: "ask" as InteractionMode, icon: MessageCircle }];

  // If current mode not available, fall back to ask
  const effectiveMode = modes.some((m) => m.mode === mode) ? mode : "ask";

  if (runtime.target !== "desktop") return null;

  return (
    <div className="mode-switcher" aria-label={t("chat.modeLabel")}>
      {modes.map(({ mode: option, icon: Icon }) => (
        <button
          key={option}
          type="button"
          className={effectiveMode === option ? "active" : ""}
          title={t(`chat.modes.${option}Desc`)}
          aria-pressed={effectiveMode === option}
          onClick={() => onModeChange(option)}
        >
          <Icon size={13} aria-hidden="true" />
          <span>{t(`chat.modes.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}
