import { useTranslation } from "react-i18next";
import { DEFAULT_SHORTCUTS } from "../core/shortcuts/default-shortcuts";
import { isMac, currentPlatform } from "../core/shortcuts/platform";

interface ShortcutHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelpOverlay({ open, onClose }: ShortcutHelpOverlayProps) {
  const { t } = useTranslation();
  if (!open) return null;

  const mac = isMac();
  const platform = currentPlatform();

  function formatAccelerator(acc: string): string {
    const parts = acc.split("+");
    const key = parts.at(-1) ?? "";
    const mods = parts.slice(0, -1);
    const symbols: Record<string, string> = mac
      ? { cmdorctrl: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" }
      : { cmdorctrl: "Ctrl+", shift: "Shift+", alt: "Alt+", ctrl: "Ctrl+" };
    const modStr = mods.map((m) => symbols[m.toLowerCase()] ?? m).join(mac ? "" : "+");
    return mac ? `${modStr}${key.toUpperCase()}` : `${modStr}${key}`;
  }

  const visible = DEFAULT_SHORTCUTS.filter(
    (s) =>
      (s.platforms as readonly string[]).includes("all") ||
      (s.platforms as readonly string[]).includes(platform),
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl p-6 min-w-[360px] max-w-[480px] shadow-xl shortcut-help"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2>{t("shortcuts.title")}</h2>
          <button
            type="button"
            className="bg-transparent border-0 text-xl cursor-pointer text-muted hover:text-foreground px-1 leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {visible.map((s) => (
            <div key={s.id} className="flex justify-between items-center py-1">
              <span className="text-sm">{t(s.labelKey)}</span>
              <kbd className="font-mono text-xs px-2 py-1 bg-surface-hover border border-border rounded">
                {formatAccelerator(s.defaultAccelerator)}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
