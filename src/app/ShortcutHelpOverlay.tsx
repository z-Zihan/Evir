import { useTranslation } from "react-i18next";
import { useOverlayBrowserGuard } from "./workspace/use-overlay-browser-guard";
import { DEFAULT_SHORTCUTS } from "../core/shortcuts/default-shortcuts";
import { isMac, currentPlatform } from "../core/shortcuts/platform";
import { Dialog, DialogContent, DialogTitle, Kbd } from "../components/ui";

interface ShortcutHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelpOverlay({ open, onClose }: ShortcutHelpOverlayProps) {
  const { t } = useTranslation();
  useOverlayBrowserGuard("shortcut-help", open);

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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="shortcut-help min-w-[360px] max-w-[480px] p-6 shadow-xl">
        <DialogTitle className="mb-4">{t("shortcuts.title")}</DialogTitle>
        <div className="flex flex-col gap-2">
          {visible.map((s) => (
            <div key={s.id} className="flex justify-between items-center py-1">
              <span className="text-sm">{t(s.labelKey)}</span>
              <Kbd>{formatAccelerator(s.defaultAccelerator)}</Kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
