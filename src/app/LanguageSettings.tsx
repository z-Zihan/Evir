import { useTranslation } from "react-i18next";

export function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const current = i18n.language.startsWith("zh") ? "zh-CN" : "en";

  const options: Array<{ value: "en" | "zh-CN"; label: string }> = [
    { value: "en", label: t("personalization.english") },
    { value: "zh-CN", label: t("personalization.chinese") },
  ];

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold m-0">{t("settings.language")}</h3>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition ${
              current === opt.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground"
            }`}
            onClick={() => void i18n.changeLanguage(opt.value)}
          >
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
