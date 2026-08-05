import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ProviderSettings } from "./ProviderSettings";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("settings.title")}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="modal-tabs">
          <button className="tab active">{t("settings.providers")}</button>
          <button
            className="tab"
            onClick={() =>
              void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")
            }
          >
            {i18n.language.startsWith("zh") ? "EN" : "中"}
          </button>
        </div>
        <div className="modal-body">
          <ProviderSettings />
        </div>
      </div>
    </div>
  );
}
