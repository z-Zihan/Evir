import { useTranslation } from "react-i18next";
import { useThemeStore } from "../features/settings/theme-store";

export function ThemeSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useThemeStore();

  const options: Array<{ value: "light" | "dark" | "system"; label: string; icon: string }> = [
    { value: "light", label: t("settings.light"), icon: "☀️" },
    { value: "dark", label: t("settings.dark"), icon: "🌙" },
    { value: "system", label: t("settings.system"), icon: "🖥️" },
  ];

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold m-0">{t("settings.theme")}</h3>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition ${
              theme === opt.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground"
            }`}
            onClick={() => setTheme(opt.value)}
          >
            <span>{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
