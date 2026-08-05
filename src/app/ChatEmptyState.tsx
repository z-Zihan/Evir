import { useTranslation } from "react-i18next";

interface ChatEmptyStateProps {
  onSendMessage: (content: string) => void;
}

export function ChatEmptyState({ onSendMessage }: ChatEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <section className="conversation-empty">
      <div className="empty-copy">
        <h2>{t("chat.emptyTitle")}</h2>
        <p>{t("chat.emptyDescription")}</p>
      </div>
      <div className="suggestions">
        {["summarize", "write", "explain"].map((key) => (
          <button
            key={key}
            type="button"
            className="suggestion-item"
            onClick={() => void onSendMessage(t(`chat.suggestions.${key}`))}
          >
            {t(`chat.suggestions.${key}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
