import { useTranslation } from "react-i18next";
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useThemeStore } from "../features/settings/theme-store";

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
    <section className="settings-designed-page">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">{t("settingsDescriptions.appearance")}</span>
          <p>{t("settingsDescriptions.theme")}</p>
        </div>
      </div>
      <div className="choice-card-grid">
        {options.map(({ value, label, description, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={`choice-card${theme === value ? " active" : ""}`}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <span className="choice-card-icon">
              <Icon size={18} />
            </span>
            <strong>{label}</strong>
            <span>{description}</span>
            {theme === value && <Check className="choice-check" size={15} />}
          </button>
        ))}
      </div>
    </section>
  );
}
