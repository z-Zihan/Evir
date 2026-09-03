import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SettingsOptionCard,
  SettingsOptionCardGrid,
  SettingsPage,
  SettingsPageIntro,
} from "../components/settings";

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
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.localization")}
        description={t("settingsDescriptions.language")}
      />
      <SettingsOptionCardGrid>
        {options.map((option) => (
          <SettingsOptionCard
            key={option.value}
            icon={<Languages />}
            title={option.label}
            description={option.sample}
            selected={current === option.value}
            aria-label={option.label}
            onClick={() => void i18n.changeLanguage(option.value)}
          />
        ))}
      </SettingsOptionCardGrid>
    </SettingsPage>
  );
}
