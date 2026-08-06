import { useTranslation } from "react-i18next";
import { Check, Languages } from "lucide-react";

export function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const current = i18n.language.startsWith("zh") ? "zh-CN" : "en";
  const options = [
    {
      value: "zh-CN" as const,
      label: t("personalization.chinese"),
      sample: t("settingsDescriptions.chineseSample"),
    },
    {
      value: "en" as const,
      label: t("personalization.english"),
      sample: t("settingsDescriptions.englishSample"),
    },
  ];
  return (
    <section className="settings-designed-page">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.localization")}</span>
          <p>{t("settingsDescriptions.language")}</p>
        </div>
      </div>
      <div className="language-choice-list">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`language-choice${current === option.value ? " active" : ""}`}
            aria-pressed={current === option.value}
            onClick={() => void i18n.changeLanguage(option.value)}
          >
            <span className="choice-card-icon">
              <Languages size={18} />
            </span>
            <span>
              <strong>{option.label}</strong>
              <small>{option.sample}</small>
            </span>
            {current === option.value && <Check size={16} />}
          </button>
        ))}
      </div>
    </section>
  );
}
