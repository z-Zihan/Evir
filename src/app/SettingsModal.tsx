import { useEffect, useRef, useState } from "react";
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
  X,
  type LucideIcon,
} from "lucide-react";
import { PersonalizationPanel } from "./PersonalizationSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { SkillSettings } from "./SkillSettings";
import { McpSettings } from "./McpSettings";
import { PrivacySettings } from "./PrivacySettings";
import { AboutSettings } from "./AboutSettings";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { MemorySettings } from "./MemorySettings";
import { ThemeSettings } from "./ThemeSettings";
import { LanguageSettings } from "./LanguageSettings";
import { ProviderSettings } from "./ProviderSettings";
import { UsagePanel } from "./UsagePanel";
import { downloadBlob, exportConversations } from "../features/chat/conversation-export";
import { importConversations } from "../features/chat/conversation-import";

export type SettingsTab =
  | "providers"
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

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open]);

  if (!open) return null;

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setImportResult(null);
    contentRef.current?.scrollTo?.({ top: 0 });
  };

  const activeItem = SETTINGS_GROUPS.flatMap((group) => group.items).find(
    (item) => item.tab === activeTab,
  );

  const handleExport = async () => {
    const blob = await exportConversations();
    downloadBlob(blob, `evir-export-${Date.now()}.json`);
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
            className="settings-close"
            type="button"
            onClick={onClose}
            aria-label={t("settings.close")}
          >
            <X size={17} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t("settings.navigation")}>
            {SETTINGS_GROUPS.map((group) => (
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
          <main className="settings-main">
            <div className="settings-section-heading">
              <h3>{activeItem ? t(activeItem.labelKey) : t("settings.title")}</h3>
            </div>
            <div className="settings-content" ref={contentRef}>
              {activeTab === "providers" && <ProviderSettings />}
              {activeTab === "personalization" && <PersonalizationPanel />}
              {activeTab === "shortcuts" && <ShortcutsSettings />}
              {activeTab === "skills" && <SkillSettings />}
              {activeTab === "mcp" && <McpSettings />}
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
              {activeTab === "memory" && <MemorySettings conversationId={null} />}
              {activeTab === "diagnostics" && <DiagnosticsSettings />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
