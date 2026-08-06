import { useTranslation } from "react-i18next";

interface ChatEmptyStateProps {
  onSendMessage: (content: string) => void;
}

export function ChatEmptyState({ onSendMessage }: ChatEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <section className="grid place-content-center w-[min(720px,calc(100%-40px))] m-auto text-center py-12 px-4">
      <div className="empty-copy">
        <h2>{t("chat.emptyTitle")}</h2>
        <p>{t("chat.emptyDescription")}</p>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {["summarize", "write", "explain"].map((key) => (
          <button
            key={key}
            type="button"
            className="min-h-[80px] p-4 rounded-xl text-left leading-normal text-sm border border-border bg-surface hover:bg-surface-hover hover:border-primary hover:-translate-y-0.5 hover:shadow-md transition"
            onClick={() => void onSendMessage(t(`chat.suggestions.${key}`))}
          >
            {t(`chat.suggestions.${key}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
