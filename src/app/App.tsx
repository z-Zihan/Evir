import { useTranslation } from "react-i18next";
import { MessageSquarePlus, Moon, Settings2, Sun } from "lucide-react";
import { useRuntime } from "../runtime/use-runtime";
import { useThemeStore } from "../features/settings/theme-store";

export function App() {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const { resolvedTheme, cycleTheme } = useThemeStore();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">E</div>
          <strong>Evir</strong>
        </div>
        <button className="primary-action" type="button">
          <MessageSquarePlus size={16} />
          {t("sidebar.newChat")}
        </button>
        <div className="section-label">{t("sidebar.recent")}</div>
        <div className="empty-list">{t("sidebar.noConversations")}</div>
        <div className="sidebar-footer">
          <button
            className="icon-button"
            type="button"
            onClick={cycleTheme}
            aria-label={t("settings.theme")}
          >
            {resolvedTheme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button
            className="language-button"
            type="button"
            onClick={() =>
              void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")
            }
          >
            {i18n.language.startsWith("zh") ? "EN" : "中"}
          </button>
          <button className="icon-button" type="button" aria-label={t("settings.title")}>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <div className="eyebrow">
              {runtime.target === "desktop" ? "Evir Desktop" : "Evir Web"}
            </div>
            <h1>{t("chat.title")}</h1>
          </div>
          <div className="capability-chip">
            {runtime.target === "desktop" ? t("runtime.agentReady") : t("runtime.chatOnly")}
          </div>
        </header>

        <section className="conversation-empty">
          <div className="empty-copy">
            <h2>{t("chat.emptyTitle")}</h2>
            <p>{t("chat.emptyDescription")}</p>
          </div>
          <div className="suggestions">
            {["summarize", "write", "explain"].map((key) => (
              <button key={key} type="button" className="suggestion-item">
                {t(`chat.suggestions.${key}`)}
              </button>
            ))}
          </div>
        </section>

        <footer className="composer-wrap">
          <div className="composer">
            <textarea aria-label={t("chat.placeholder")} placeholder={t("chat.placeholder")} />
            <div className="composer-footer">
              <span>{t("chat.modelPlaceholder")}</span>
              <button type="button" disabled>
                {t("chat.send")}
              </button>
            </div>
          </div>
          <p className="disclaimer">{t("chat.disclaimer")}</p>
        </footer>
      </main>
    </div>
  );
}
