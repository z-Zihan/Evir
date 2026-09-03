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
    <section className="conversation-empty flex h-full flex-col items-center justify-center gap-6 py-10">
      <div className="empty-copy flex flex-col items-center gap-1.5 text-center">
        <span className="empty-eyebrow text-[11px] font-medium tracking-wide text-muted uppercase">
          {t("chat.startHere")}
        </span>
        <h2 className="m-0 text-[19px] font-semibold tracking-tight text-foreground">
          {t("chat.emptyTitle")}
        </h2>
        <p className="m-0 max-w-[400px] text-[12.5px] leading-relaxed text-muted">
          {t("chat.emptyDescription")}
        </p>
      </div>
      <div className="suggestions flex flex-col gap-1.5">
        {suggestions.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className="suggestion-item group/sug flex w-[320px] cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-[12.5px] text-foreground transition-colors select-none hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => void onSendMessage(t(`chat.suggestions.${key}`))}
          >
            <span
              className="suggestion-icon grid size-7 shrink-0 place-items-center rounded-lg bg-surface-hover text-muted transition-colors group-hover/sug:bg-primary/[0.08] group-hover/sug:text-primary"
              aria-hidden="true"
            >
              <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate">{t(`chat.suggestions.${key}`)}</span>
            <ArrowUpRight
              className="suggestion-arrow shrink-0 text-muted transition-transform group-hover/sug:translate-x-0.5 group-hover/sug:text-primary"
              size={14}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
