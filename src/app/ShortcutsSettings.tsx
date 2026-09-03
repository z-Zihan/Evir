import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  MessageSquarePlus,
  PanelLeft,
  Send,
  Settings2,
  Square,
  type LucideIcon,
} from "lucide-react";
import { Kbd } from "../components/ui";
import {
  SettingsGroup,
  SettingsPage,
  SettingsPageIntro,
  SettingsSection,
} from "../components/settings";
import { DEFAULT_SHORTCUTS } from "../core/shortcuts/default-shortcuts";
import type { ShortcutDefinition } from "../core/shortcuts/types";
import { currentPlatform, isMac } from "../core/shortcuts/platform";

type ShortcutGroupId = "navigation" | "conversation";

interface ShortcutPresentation {
  group: ShortcutGroupId;
  icon: LucideIcon;
  descriptionKey: string;
}

const SHORTCUT_PRESENTATION: Record<string, ShortcutPresentation> = {
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
};

const GROUP_ORDER: ShortcutGroupId[] = ["navigation", "conversation"];

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
    <div className="flex shrink-0 items-center gap-1" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {tokens.map((token, index) => (
          <Kbd key={`${token}-${index}`}>{token}</Kbd>
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
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted"
      >
        {Icon ? <Icon size={15} strokeWidth={1.7} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-[12.5px] font-medium text-foreground">
          {t(shortcut.labelKey)}
        </strong>
        <span className="block text-[11px] text-muted">
          {presentation ? t(presentation.descriptionKey) : ""}
        </span>
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
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.keyboard")}
        description={t("settingsDescriptions.shortcuts")}
        action={
          <div className="flex flex-col items-end">
            <strong className="text-[12.5px] text-foreground">
              {t(`shortcuts.platform.${platform}`)}
            </strong>
            <span className="text-[11px] text-muted">
              {t("shortcuts.availableCount", { count: shortcuts.length })}
            </span>
          </div>
        }
      />

      {GROUP_ORDER.map((group) => {
        const groupShortcuts = shortcuts.filter(
          (shortcut) => SHORTCUT_PRESENTATION[shortcut.id]?.group === group,
        );
        if (groupShortcuts.length === 0) return null;

        return (
          <SettingsSection
            key={group}
            title={t(`shortcuts.groups.${group}`)}
            description={t(`shortcuts.groupDescriptions.${group}`)}
          >
            <SettingsGroup>
              <ul className="divide-y divide-border">
                {groupShortcuts.map((shortcut) => (
                  <ShortcutRow key={shortcut.id} shortcut={shortcut} />
                ))}
              </ul>
            </SettingsGroup>
          </SettingsSection>
        );
      })}

      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <Keyboard size={14} aria-hidden="true" />
        <span>{t("shortcuts.comingSoon")}</span>
      </div>
    </SettingsPage>
  );
}
