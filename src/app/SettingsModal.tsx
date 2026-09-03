import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOverlayBrowserGuard } from "./workspace/use-overlay-browser-guard";
import {
  BarChart3,
  Brain,
  Boxes,
  Braces,
  Globe2,
  Info,
  Keyboard,
  Palette,
  ShieldCheck,
  ServerCog,
  SlidersHorizontal,
  Stethoscope,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
// Settings panels are lazy-loaded: the modal shell (nav + focus handling)
// stays in the entry chunk while all 13 panels — including heavy deps like
// react-easy-crop, dexie-backed stores, and usage analytics — load on first
// open of the settings dialog.
const PersonalizationPanel = lazy(() =>
  import("./PersonalizationSettings").then((m) => ({ default: m.PersonalizationPanel })),
);
const LocalIdentityPanel = lazy(() =>
  import("./LocalIdentitySettings").then((m) => ({ default: m.LocalIdentityPanel })),
);
const ShortcutsSettings = lazy(() =>
  import("./ShortcutsSettings").then((m) => ({ default: m.ShortcutsSettings })),
);
const SkillSettings = lazy(() =>
  import("./SkillSettings").then((m) => ({ default: m.SkillSettings })),
);
const McpSettings = lazy(() => import("./McpSettings").then((m) => ({ default: m.McpSettings })));
const PrivacySettings = lazy(() =>
  import("./PrivacySettings").then((m) => ({ default: m.PrivacySettings })),
);
const AboutSettings = lazy(() =>
  import("./AboutSettings").then((m) => ({ default: m.AboutSettings })),
);
const DiagnosticsSettings = lazy(() =>
  import("./DiagnosticsSettings").then((m) => ({ default: m.DiagnosticsSettings })),
);
const MemorySettings = lazy(() =>
  import("./MemorySettings").then((m) => ({ default: m.MemorySettings })),
);
const ThemeSettings = lazy(() =>
  import("./ThemeSettings").then((m) => ({ default: m.ThemeSettings })),
);
const LanguageSettings = lazy(() =>
  import("./LanguageSettings").then((m) => ({ default: m.LanguageSettings })),
);
const ProviderSettings = lazy(() =>
  import("./ProviderSettings").then((m) => ({ default: m.ProviderSettings })),
);
const UsagePanel = lazy(() => import("./UsagePanel").then((m) => ({ default: m.UsagePanel })));
const BrowserSettings = lazy(() =>
  import("./BrowserSettings").then((m) => ({ default: m.BrowserSettings })),
);
import { Button, Dialog, DialogContent, DialogTitle, Tip } from "../components/ui";
import { LoadingState } from "../components/feedback";
import { SettingsGroup, SettingsPage, SettingsRow } from "../components/settings";
import { downloadBlob, exportConversations } from "../features/chat/conversation-export";
import { importConversations } from "../features/chat/conversation-import";
import { getRuntime } from "../runtime/use-runtime";
import { useChatStore } from "../features/chat/chat-store";
import { useWorkspaceStore } from "../features/workspace/workspace-store";
import { isSettingsTabAvailable, type SettingsTab } from "./settings-navigation";
import { logger } from "../core/logging/logger";

export type { SettingsTab } from "./settings-navigation";

interface SettingsNavItem {
  tab: SettingsTab;
  labelKey: string;
  icon: LucideIcon;
}

const SETTINGS_GROUPS: Array<{ labelKey: string; items: SettingsNavItem[] }> = [
  {
    labelKey: "settings.groups.account",
    items: [
      { tab: "providers", labelKey: "settings.providers", icon: ServerCog },
      { tab: "identity", labelKey: "settings.identity", icon: UserRound },
      {
        tab: "personalization",
        labelKey: "settings.personalization",
        icon: SlidersHorizontal,
      },
      { tab: "theme", labelKey: "settings.theme", icon: Palette },
      { tab: "language", labelKey: "settings.language", icon: Globe2 },
    ],
  },
  {
    labelKey: "settings.groups.capabilities",
    items: [
      { tab: "skills", labelKey: "settings.skills", icon: Braces },
      { tab: "mcp", labelKey: "settings.mcp", icon: Boxes },
      { tab: "browser", labelKey: "settings.browser", icon: Globe2 },
      { tab: "memory", labelKey: "memory.title", icon: Brain },
    ],
  },
  {
    labelKey: "settings.groups.system",
    items: [
      { tab: "shortcuts", labelKey: "settings.shortcuts", icon: Keyboard },
      { tab: "usage", labelKey: "settings.usage", icon: BarChart3 },
      { tab: "privacy", labelKey: "settings.privacy", icon: ShieldCheck },
      { tab: "diagnostics", labelKey: "settings.diagnostics", icon: Stethoscope },
      { tab: "about", labelKey: "settings.about", icon: Info },
    ],
  },
];

function SettingsPanelFallback() {
  const { t } = useTranslation();
  return <LoadingState label={t("common.loading")} />;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsModal({ open, onClose, initialTab = "providers" }: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  useOverlayBrowserGuard("settings-modal", open);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const closeSettings = () => {
    logger.info("ui", "ui.close", {
      actionId: crypto.randomUUID(),
      surface: "settings",
      tab: effectiveActiveTab,
    });
    onClose();
  };
  onCloseRef.current = closeSettings;
  const runtimeTarget = getRuntime().target;
  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isSettingsTabAvailable(item.tab, runtimeTarget)),
  })).filter((group) => group.items.length > 0);
  const effectiveActiveTab = isSettingsTabAvailable(activeTab, runtimeTarget)
    ? activeTab
    : "providers";

  useEffect(() => {
    if (open) {
      setActiveTab(isSettingsTabAvailable(initialTab, runtimeTarget) ? initialTab : "providers");
    }
  }, [initialTab, open, runtimeTarget]);

  const handleTabChange = (tab: SettingsTab) => {
    logger.info("ui", "ui.tab-change", {
      actionId: crypto.randomUUID(),
      surface: "settings",
      fromTab: effectiveActiveTab,
      toTab: tab,
    });
    setActiveTab(tab);
    setImportResult(null);
    contentRef.current?.scrollTo?.({ top: 0 });
  };

  const activeItem = visibleGroups
    .flatMap((group) => group.items)
    .find((item) => item.tab === effectiveActiveTab);

  const handleExport = async () => {
    const blob = await exportConversations();
    await downloadBlob(blob, `evir-export-${Date.now()}.json`);
  };

  const handleImport = async (file: File) => {
    try {
      const { imported, skipped } = await importConversations(file);
      setImportResult(t("settings.importSuccess", { imported, skipped }));
    } catch (error) {
      setImportResult(
        t("settings.importFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCloseRef.current();
      }}
    >
      <DialogContent
        className="settings-dialog max-w-none p-0"
        showCloseButton={false}
        initialFocus={closeButtonRef}
      >
        <header className="settings-header">
          <div>
            <span className="settings-eyebrow">Evir</span>
            <DialogTitle>{t("settings.title")}</DialogTitle>
          </div>
          <Tip content={t("settings.close")} side="bottom">
            <Button
              ref={closeButtonRef}
              variant="ghost"
              size="icon"
              className="settings-close"
              onClick={closeSettings}
              aria-label={t("settings.close")}
            >
              <X size={17} />
            </Button>
          </Tip>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t("settings.navigation")}>
            {visibleGroups.map((group) => (
              <div className="settings-nav-group" key={group.labelKey}>
                <span className="settings-nav-label">{t(group.labelKey)}</span>
                {group.items.map(({ tab, labelKey, icon: Icon }) => (
                  <button
                    className={`settings-nav-item${effectiveActiveTab === tab ? " active" : ""}`}
                    type="button"
                    key={tab}
                    aria-current={effectiveActiveTab === tab ? "page" : undefined}
                    onClick={() => handleTabChange(tab)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <label className="settings-mobile-nav">
            <span>{t("settings.navigation")}</span>
            <select
              className="settings-mobile-select"
              value={effectiveActiveTab}
              onChange={(event) => handleTabChange(event.target.value as SettingsTab)}
            >
              {visibleGroups.map((group) => (
                <optgroup key={group.labelKey} label={t(group.labelKey)}>
                  {group.items.map(({ tab, labelKey }) => (
                    <option key={tab} value={tab}>
                      {t(labelKey)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <main className="settings-main">
            <div className="settings-section-heading">
              <h3 id="settings-section-title">
                {activeItem ? t(activeItem.labelKey) : t("settings.title")}
              </h3>
            </div>
            <div
              className="settings-content"
              ref={contentRef}
              tabIndex={0}
              aria-labelledby="settings-section-title"
            >
              <Suspense fallback={<SettingsPanelFallback />}>
                {effectiveActiveTab === "providers" && <ProviderSettings />}
                {effectiveActiveTab === "identity" && <LocalIdentityPanel />}
                {effectiveActiveTab === "personalization" && <PersonalizationPanel />}
                {effectiveActiveTab === "shortcuts" && <ShortcutsSettings />}
                {effectiveActiveTab === "skills" && <SkillSettings />}
                {effectiveActiveTab === "mcp" && <McpSettings />}
                {effectiveActiveTab === "browser" && <BrowserSettings />}
                {effectiveActiveTab === "usage" && <UsagePanel />}
                {effectiveActiveTab === "privacy" && (
                  <SettingsPage>
                    <SettingsGroup>
                      <SettingsRow
                        label={t("settings.portability")}
                        description={t("settings.portabilityDescription")}
                        control={
                          <>
                            <Button
                              variant="secondary"
                              size="lg"
                              onClick={() => void handleExport()}
                            >
                              {t("settings.exportAll")}
                            </Button>
                            <Button
                              variant="secondary"
                              size="lg"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              {t("settings.importAll")}
                            </Button>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="application/json,.json"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void handleImport(file);
                                if (fileInputRef.current) fileInputRef.current.value = "";
                              }}
                            />
                          </>
                        }
                      />
                      {importResult && (
                        <div className="form-message" role="alert">
                          {importResult}
                        </div>
                      )}
                    </SettingsGroup>
                    <PrivacySettings />
                  </SettingsPage>
                )}
                {effectiveActiveTab === "about" && <AboutSettings />}
                {effectiveActiveTab === "theme" && <ThemeSettings />}
                {effectiveActiveTab === "language" && <LanguageSettings />}
                {effectiveActiveTab === "memory" && (
                  <MemorySettings
                    conversationId={currentConversationId}
                    workspacePath={currentWorkspace}
                  />
                )}
                {effectiveActiveTab === "diagnostics" && <DiagnosticsSettings />}
              </Suspense>
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
