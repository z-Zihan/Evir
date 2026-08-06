import { useTranslation } from "react-i18next";
import { ArrowUpRight, FileText, Lightbulb, PenLine, type LucideIcon } from "lucide-react";

interface ChatEmptyStateProps {
  onSendMessage: (content: string) => void;
}

export function ChatEmptyState({ onSendMessage }: ChatEmptyStateProps) {
  const { t } = useTranslation();
  const suggestions: Array<{ key: string; icon: LucideIcon }> = [
    { key: "summarize", icon: FileText },
    { key: "write", icon: PenLine },
    { key: "explain", icon: Lightbulb },
  ];

  return (
    <section className="conversation-empty">
      <div className="empty-copy">
        <span className="empty-eyebrow">{t("chat.startHere")}</span>
        <h2>{t("chat.emptyTitle")}</h2>
        <p>{t("chat.emptyDescription")}</p>
      </div>
      <div className="suggestions">
        {suggestions.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className="suggestion-item"
            onClick={() => void onSendMessage(t(`chat.suggestions.${key}`))}
          >
            <span className="suggestion-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span>{t(`chat.suggestions.${key}`)}</span>
            <ArrowUpRight className="suggestion-arrow" size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
