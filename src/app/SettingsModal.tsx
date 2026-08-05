import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { ProviderSettings } from "./ProviderSettings";
import { UsagePanel } from "./UsagePanel";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<"providers" | "personalization" | "usage">(
    "providers",
  );
  if (!open) return null;

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
            onClick={() => setActiveTab("providers")}
          >
            {t("settings.providers")}
          </button>
          <button
            className={`tab${activeTab === "personalization" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveTab("personalization")}
          >
            {t("settings.personalization")}
          </button>
          <button
            className={`tab${activeTab === "usage" ? " active" : ""}`}
            type="button"
            onClick={() => setActiveTab("usage")}
          >
            {t("settings.usage")}
          </button>
          <button
            className="language-button settings-language"
            type="button"
            aria-label={t("settings.switchLanguage")}
            onClick={() =>
              void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")
            }
          >
            {t("settings.languageToggle")}
          </button>
        </div>
        <div className="modal-body">
          {activeTab === "providers" && <ProviderSettings />}
          {activeTab === "personalization" && <PersonalizationSettings />}
          {activeTab === "usage" && <UsagePanel />}
        </div>
      </div>
    </div>
  );
}
