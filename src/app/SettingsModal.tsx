import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { PersonalizationPanel } from "./PersonalizationSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { SkillSettings } from "./SkillSettings";
import { McpSettings } from "./McpSettings";
import { PrivacySettings } from "./PrivacySettings";
import { AboutSettings } from "./AboutSettings";
import { MemorySettings } from "./MemorySettings";
import { ThemeSettings } from "./ThemeSettings";
import { ProviderSettings } from "./ProviderSettings";
import { UsagePanel } from "./UsagePanel";
import { downloadBlob, exportConversations } from "../features/chat/conversation-export";
import { importConversations } from "../features/chat/conversation-import";

type SettingsTab =
  | "providers"
  | "personalization"
  | "shortcuts"
  | "skills"
  | "mcp"
  | "usage"
  | "data"
  | "privacy"
  | "theme"
  | "memory"
  | "about";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setImportResult(null);
  };

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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200]">
      <div
        className="bg-surface border border-border rounded-2xl w-[min(640px,calc(100%-40px))] max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 px-5 border-b border-border">
          <h2>{t("settings.title")}</h2>
          <button
            className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition"
            type="button"
            onClick={onClose}
            aria-label={t("settings.close")}
          >
            <X size={17} />
          </button>
        </div>
        <div className="flex gap-1 px-4 py-2 border-b border-border overflow-x-auto items-center">
          {/* 基础 */}
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "providers" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("providers")}
          >
            {t("settings.providers")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "personalization" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("personalization")}
          >
            {t("settings.personalization")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "theme" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("theme")}
          >
            {t("settings.theme")}
          </button>
          <span className="w-px h-5 bg-border mx-1" />
          {/* 能力 */}
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "skills" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("skills")}
          >
            {t("settings.skills")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "mcp" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("mcp")}
          >
            {t("settings.mcp")}
          </button>
          <span className="w-px h-5 bg-border mx-1" />
          {/* 系统 */}
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "shortcuts" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("shortcuts")}
          >
            {t("settings.shortcuts")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "usage" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("usage")}
          >
            {t("settings.usage")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "memory" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("memory")}
          >
            {t("memory.title")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "data" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("data")}
          >
            {t("settings.data")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "privacy" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("privacy")}
          >
            {t("settings.privacy")}
          </button>
          <span className="w-px h-5 bg-border mx-1" />
          {/* 支持 */}
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap border-0 ${activeTab === "about" ? "bg-primary text-primary-fg" : "bg-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            type="button"
            onClick={() => handleTabChange("about")}
          >
            {t("settings.about")}
          </button>
          <button
            className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium text-muted hover:bg-surface-hover hover:text-foreground transition border-0 bg-transparent"
            type="button"
            aria-label={t("settings.switchLanguage")}
            onClick={() =>
              void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")
            }
          >
            {i18n.language.startsWith("zh") ? "EN" : "中文"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "providers" && <ProviderSettings />}
          {activeTab === "personalization" && <PersonalizationPanel />}
          {activeTab === "shortcuts" && <ShortcutsSettings />}
          {activeTab === "skills" && <SkillSettings />}
          {activeTab === "mcp" && <McpSettings />}
          {activeTab === "usage" && <UsagePanel />}
          {activeTab === "privacy" && <PrivacySettings />}
          {activeTab === "about" && <AboutSettings />}
          {activeTab === "theme" && <ThemeSettings />}
          {activeTab === "memory" && <MemorySettings conversationId={null} />}
          {activeTab === "data" && (
            <div className="data-settings">
              <h3>{t("settings.data")}</h3>
              <div className="data-actions">
                <button type="button" onClick={() => void handleExport()}>
                  {t("settings.exportAll")}
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  {t("settings.importAll")}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImport(file);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
              </div>
              {importResult && <div className="import-result">{importResult}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
