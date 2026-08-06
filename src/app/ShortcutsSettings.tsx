import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_SHORTCUTS } from "../core/shortcuts/default-shortcuts";
import type { ShortcutDefinition } from "../core/shortcuts/types";

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function formatAccelerator(accelerator: string): string {
  const mac = isMac();
  let formatted = accelerator;
  if (mac) {
    formatted = formatted.replace(/CmdOrCtrl/g, "\u2318");
  } else {
    formatted = formatted.replace(/CmdOrCtrl/g, "Ctrl");
  }
  return formatted
    .replace(/Shift/g, mac ? "\u21E7" : "Shift")
    .replace(/Escape/g, mac ? "\u238B" : "Esc")
    .replace(/Enter/g, mac ? "\u21A9" : "Enter");
}

function groupedShortcuts(): Map<string, ShortcutDefinition[]> {
  const map = new Map<string, ShortcutDefinition[]>();
  for (const shortcut of DEFAULT_SHORTCUTS) {
    const group = map.get(shortcut.scope) ?? [];
    group.push(shortcut);
    map.set(shortcut.scope, group);
  }
  return map;
}

export function ShortcutsSettings() {
  const { t } = useTranslation();
  const groups = useMemo(() => groupedShortcuts(), []);

  return (
    <section className="shortcuts-settings">
      <h3>{t("settings.shortcuts")}</h3>
      {[...groups.entries()].map(([scope, shortcuts]) => (
        <div key={scope} className="shortcuts-group">
          <ul className="shortcuts-list">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.id} className="shortcut-item">
                <span className="shortcut-label">{t(shortcut.labelKey)}</span>
                <div className="shortcut-right">
                  <kbd className="shortcut-key">
                    {formatAccelerator(shortcut.defaultAccelerator)}
                  </kbd>
                  <span className="shortcut-scope-badge">{scope}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="shortcuts-note">{t("shortcuts.comingSoon")}</p>
    </section>
  );
}
