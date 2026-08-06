import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  FolderOpen,
  Keyboard,
  MessageSquarePlus,
  PanelLeft,
  Search,
  Send,
  Settings2,
  Square,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_SHORTCUTS } from "../core/shortcuts/default-shortcuts";
import type { ShortcutDefinition } from "../core/shortcuts/types";
import { currentPlatform, isMac } from "../core/shortcuts/platform";

type ShortcutGroupId = "navigation" | "conversation" | "workspace";

interface ShortcutPresentation {
  group: ShortcutGroupId;
  icon: LucideIcon;
  descriptionKey: string;
}

const SHORTCUT_PRESENTATION: Record<string, ShortcutPresentation> = {
  "command-palette": {
    group: "navigation",
    icon: Command,
    descriptionKey: "shortcuts.commandPaletteDescription",
  },
  "open-settings": {
    group: "navigation",
    icon: Settings2,
    descriptionKey: "shortcuts.openSettingsDescription",
  },
  "toggle-sidebar": {
    group: "navigation",
    icon: PanelLeft,
    descriptionKey: "shortcuts.toggleSidebarDescription",
  },
  "search-conversations": {
    group: "navigation",
    icon: Search,
    descriptionKey: "shortcuts.searchConversationsDescription",
  },
  "shortcut-help": {
    group: "navigation",
    icon: Keyboard,
    descriptionKey: "shortcuts.shortcutHelpDescription",
  },
  "new-conversation": {
    group: "conversation",
    icon: MessageSquarePlus,
    descriptionKey: "shortcuts.newConversationDescription",
  },
  "send-message": {
    group: "conversation",
    icon: Send,
    descriptionKey: "shortcuts.sendMessageDescription",
  },
  "stop-current-run": {
    group: "conversation",
    icon: Square,
    descriptionKey: "shortcuts.stopCurrentRunDescription",
  },
  "open-workspace": {
    group: "workspace",
    icon: FolderOpen,
    descriptionKey: "shortcuts.openWorkspaceDescription",
  },
};

const GROUP_ORDER: ShortcutGroupId[] = ["navigation", "conversation", "workspace"];

function acceleratorTokens(accelerator: string): string[] {
  const mac = isMac();
  return accelerator.split("+").map((token) => {
    if (token === "CmdOrCtrl") return mac ? "⌘" : "Ctrl";
    if (token === "Shift") return mac ? "⇧" : "Shift";
    if (token === "Escape") return mac ? "⎋" : "Esc";
    if (token === "Enter") return mac ? "↩" : "Enter";
    return token;
  });
}

function acceleratorLabel(tokens: string[]): string {
  return isMac() ? tokens.join(" ") : tokens.join("+");
}

function availableShortcuts(): ShortcutDefinition[] {
  const platform = currentPlatform();
  return DEFAULT_SHORTCUTS.filter(({ platforms }) =>
    platforms.some((candidate) => candidate === "all" || candidate === platform),
  );
}

function ShortcutKeys({ accelerator }: { accelerator: string }) {
  const tokens = acceleratorTokens(accelerator);
  const label = acceleratorLabel(tokens);

  return (
    <div className="shortcut-keys" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className="shortcut-keycaps" aria-hidden="true">
        {tokens.map((token, index) => (
          <kbd key={`${token}-${index}`}>{token}</kbd>
        ))}
      </span>
    </div>
  );
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutDefinition }) {
  const { t } = useTranslation();
  const presentation = SHORTCUT_PRESENTATION[shortcut.id];
  const Icon = presentation?.icon;

  return (
    <li className="shortcut-item">
      <span className="shortcut-action-icon" aria-hidden="true">
        {Icon ? <Icon size={15} strokeWidth={1.7} /> : null}
      </span>
      <span className="shortcut-copy">
        <strong>{t(shortcut.labelKey)}</strong>
        <span>{presentation ? t(presentation.descriptionKey) : ""}</span>
      </span>
      <ShortcutKeys accelerator={shortcut.defaultAccelerator} />
    </li>
  );
}

export function ShortcutsSettings() {
  const { t } = useTranslation();
  const shortcuts = useMemo(() => availableShortcuts(), []);
  const platform = currentPlatform();

  return (
    <section className="shortcuts-settings">
      <div className="shortcut-overview">
        <div className="shortcut-overview-mark" aria-hidden="true">
          <Command size={19} strokeWidth={1.6} />
        </div>
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.keyboard")}</span>
          <h3>{t("shortcuts.title")}</h3>
          <p>{t("settingsDescriptions.shortcuts")}</p>
        </div>
        <div className="shortcut-platform-summary">
          <strong>{t(`shortcuts.platform.${platform}`)}</strong>
          <span>{t("shortcuts.availableCount", { count: shortcuts.length })}</span>
        </div>
      </div>

      <div className="shortcut-map">
        {GROUP_ORDER.map((group) => {
          const groupShortcuts = shortcuts.filter(
            (shortcut) => SHORTCUT_PRESENTATION[shortcut.id]?.group === group,
          );
          if (groupShortcuts.length === 0) return null;

          return (
            <section className="shortcuts-group" key={group}>
              <div className="shortcut-group-header">
                <h4>{t(`shortcuts.groups.${group}`)}</h4>
                <span>{t(`shortcuts.groupDescriptions.${group}`)}</span>
              </div>
              <ul className="shortcuts-list">
                {groupShortcuts.map((shortcut) => (
                  <ShortcutRow key={shortcut.id} shortcut={shortcut} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="shortcuts-note">
        <Keyboard size={14} aria-hidden="true" />
        <span>{t("shortcuts.comingSoon")}</span>
      </div>
    </section>
  );
}
