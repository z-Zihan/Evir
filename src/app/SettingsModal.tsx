import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, X } from "lucide-react";
import { PersonalizationPanel } from "./PersonalizationSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { SkillSettings } from "./SkillSettings";
import { McpSettings } from "./McpSettings";
import { PrivacySettings } from "./PrivacySettings";
import { ProviderSettings } from "./ProviderSettings";
import { UsagePanel } from "./UsagePanel";
import { downloadBlob, exportConversations } from "../features/chat/conversation-export";
import { importConversations } from "../features/chat/conversation-import";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<
    "providers" | "personalization" | "shortcuts" | "skills" | "mcp" | "usage" | "data" | "privacy"
  >("providers");
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const handleTabChange = (
    tab:
      | "providers"
      | "personalization"
      | "shortcuts"
      | "skills"
      | "mcp"
      | "usage"
      | "data"
      | "privacy",
  ) => {
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("settings.title")}</h2>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={t("settings.close")}
          >
            <X size={17} />
          </button>
        </div>
        <div className="modal-tabs">
          <button
            className={`tab${activeTab === "providers" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("providers")}
          >
            {t("settings.providers")}
          </button>
          <button
            className={`tab${activeTab === "personalization" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("personalization")}
          >
            {t("settings.personalization")}
          </button>
          <button
            className={`tab${activeTab === "shortcuts" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("shortcuts")}
          >
            {t("settings.shortcuts")}
          </button>
          <button
            className={`tab${activeTab === "skills" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("skills")}
          >
            {t("settings.skills")}
          </button>
          <button
            className={`tab${activeTab === "mcp" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("mcp")}
          >
            {t("settings.mcp")}
          </button>
          <button
            className={`tab${activeTab === "usage" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("usage")}
          >
            {t("settings.usage")}
          </button>
          <button
            className={`tab${activeTab === "data" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("data")}
          >
            <Database size={14} style={{ display: "inline", marginRight: 4 }} />
            {t("settings.data")}
          </button>
          <button
            className={`tab${activeTab === "privacy" ? " active" : ""}`}
            type="button"
            onClick={() => handleTabChange("privacy")}
          >
            {t("settings.privacy")}
          </button>
          <button
            className="language-button settings-language"
            type="button"
            aria-label={t("settings.switchLanguage")}
            onClick={() =>
              void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")
            }
          >
            {i18n.language.startsWith("zh") ? "EN" : "中"}
          </button>
        </div>
        <div className="modal-body">
          {activeTab === "providers" && <ProviderSettings />}
          {activeTab === "personalization" && <PersonalizationPanel />}
          {activeTab === "shortcuts" && <ShortcutsSettings />}
          {activeTab === "skills" && <SkillSettings />}
          {activeTab === "mcp" && <McpSettings />}
          {activeTab === "usage" && <UsagePanel />}
          {activeTab === "privacy" && <PrivacySettings />}
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
