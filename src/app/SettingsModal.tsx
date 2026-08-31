import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { downloadBlob, exportConversations } from "../features/chat/conversation-export";
import { importConversations } from "../features/chat/conversation-import";
import { getRuntime } from "../runtime/use-runtime";
import { useChatStore } from "../features/chat/chat-store";
import { useWorkspaceStore } from "../features/workspace/workspace-store";

export type SettingsTab =
  | "browser"
  | "providers"
  | "identity"
  | "personalization"
  | "shortcuts"
  | "skills"
  | "mcp"
  | "usage"
  | "privacy"
  | "theme"
  | "language"
  | "memory"
  | "diagnostics"
  | "about";

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
  return (
    <p className="text-sm text-muted p-4" role="status">
      {t("common.loading")}
    </p>
  );
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsModal({ open, onClose, initialTab = "providers" }: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  onCloseRef.current = onClose;
  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.tab !== "mcp" || getRuntime().target === "desktop"),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        document.querySelector(
          ".settings-form-backdrop, .confirmation-backdrop, .avatar-crop-backdrop",
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setImportResult(null);
    contentRef.current?.scrollTo?.({ top: 0 });
  };

  const activeItem = visibleGroups
    .flatMap((group) => group.items)
    .find((item) => item.tab === activeTab);

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
    <div className="settings-backdrop">
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <span className="settings-eyebrow">Evir</span>
            <h2 id="settings-title">{t("settings.title")}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="settings-close"
            type="button"
            onClick={onClose}
            aria-label={t("settings.close")}
            data-tip={t("settings.close")}
          >
            <X size={17} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t("settings.navigation")}>
            {visibleGroups.map((group) => (
              <div className="settings-nav-group" key={group.labelKey}>
                <span className="settings-nav-label">{t(group.labelKey)}</span>
                {group.items.map(({ tab, labelKey, icon: Icon }) => (
                  <button
                    className={`settings-nav-item${activeTab === tab ? " active" : ""}`}
                    type="button"
                    key={tab}
                    aria-current={activeTab === tab ? "page" : undefined}
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
              value={activeTab}
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
                {activeTab === "providers" && <ProviderSettings />}
                {activeTab === "identity" && <LocalIdentityPanel />}
                {activeTab === "personalization" && <PersonalizationPanel />}
                {activeTab === "shortcuts" && <ShortcutsSettings />}
                {activeTab === "skills" && <SkillSettings />}
                {activeTab === "mcp" && <McpSettings />}
                {activeTab === "browser" && <BrowserSettings />}
                {activeTab === "usage" && <UsagePanel />}
                {activeTab === "privacy" && (
                  <div className="data-privacy-settings">
                    <section className="settings-data-actions">
                      <div>
                        <h4>{t("settings.portability")}</h4>
                        <p>{t("settings.portabilityDescription")}</p>
                      </div>
                      <div className="settings-data-buttons">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void handleExport()}
                        >
                          {t("settings.exportAll")}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {t("settings.importAll")}
                        </button>
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
                      </div>
                      {importResult && (
                        <div className="form-message" role="alert">
                          {importResult}
                        </div>
                      )}
                    </section>
                    <PrivacySettings />
                  </div>
                )}
                {activeTab === "about" && <AboutSettings />}
                {activeTab === "theme" && <ThemeSettings />}
                {activeTab === "language" && <LanguageSettings />}
                {activeTab === "memory" && (
                  <MemorySettings
                    conversationId={currentConversationId}
                    workspacePath={currentWorkspace}
                  />
                )}
                {activeTab === "diagnostics" && <DiagnosticsSettings />}
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
