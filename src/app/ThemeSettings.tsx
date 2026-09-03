import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../features/settings/theme-store";
import {
  SettingsOptionCard,
  SettingsOptionCardGrid,
  SettingsPage,
  SettingsPageIntro,
} from "../components/settings";

export function ThemeSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useThemeStore();
  const options: Array<{
    value: "light" | "dark" | "system";
    label: string;
    description: string;
    icon: LucideIcon;
  }> = [
    {
      value: "light",
      label: t("settings.light"),
      description: t("settingsDescriptions.themeLight"),
      icon: Sun,
    },
    {
      value: "dark",
      label: t("settings.dark"),
      description: t("settingsDescriptions.themeDark"),
      icon: Moon,
    },
    {
      value: "system",
      label: t("settings.system"),
      description: t("settingsDescriptions.themeSystem"),
      icon: Monitor,
    },
  ];
  return (
    <SettingsPage>
      <SettingsPageIntro
        eyebrow={t("settingsDescriptions.appearance")}
        description={t("settingsDescriptions.theme")}
      />
      <SettingsOptionCardGrid>
        {options.map(({ value, label, description, icon: Icon }) => (
          <SettingsOptionCard
            key={value}
            icon={<Icon />}
            title={label}
            description={description}
            selected={theme === value}
            aria-label={label}
            onClick={() => setTheme(value)}
          />
        ))}
      </SettingsOptionCardGrid>
    </SettingsPage>
  );
}
