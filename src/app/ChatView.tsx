import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "../features/chat/chat-store";
import { useProviderStore } from "../features/provider/provider-store";

interface ChatViewProps {
  input: string;
  onInputChange: (input: string) => void;
  onSendMessage: () => void;
  onOpenSettings: () => void;
}

export function ChatView({ input, onInputChange, onSendMessage, onOpenSettings }: ChatViewProps) {
  const { t } = useTranslation();
  const { messages, isStreaming, streamingContent, error, sendMessage, stopGeneration } =
    useChatStore();
  const { getDefaultProvider } = useProviderStore();
  const provider = getDefaultProvider();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  if (!provider) {
    return (
      <main className="workspace">
        <section className="conversation-empty">
          <div className="empty-copy">
            <h2>{t("chat.noProvider")}</h2>
            <button className="primary-action" type="button" onClick={onOpenSettings}>
              {t("chat.addProviderFirst")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <div className="messages-area" ref={scrollRef}>
        {messages.length === 0 && !isStreaming ? (
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
                  onClick={() => void sendMessage(t(`chat.suggestions.${key}`))}
                >
                  {t(`chat.suggestions.${key}`)}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="message-list">
            {messages.map((msg) => (
              <div key={msg.id} className={`message message-${msg.role}`}>
                <div className="message-content">
                  {msg.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                  {msg.status === "stopped" && (
                    <span className="message-stopped">({t("chat.stopped")})</span>
                  )}
                  {msg.status === "error" && msg.errorMessage && (
                    <div className="message-error">{msg.errorMessage}</div>
                  )}
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="message message-assistant">
                <div className="message-content">
                  {streamingContent ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  ) : (
                    <span className="message-typing">…</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {error && <div className="chat-error">{error}</div>}
      <footer className="composer-wrap">
        <div className="composer">
          <textarea
            aria-label={t("chat.placeholder")}
            placeholder={t("chat.placeholder")}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <div className="composer-footer">
            <span>{provider.modelId}</span>
            {isStreaming ? (
              <button type="button" className="stop-button" onClick={stopGeneration}>
                <Square size={14} />
                {t("chat.stop")}
              </button>
            ) : (
              <button type="button" disabled={!input.trim()} onClick={onSendMessage}>
                {t("chat.send")}
              </button>
            )}
          </div>
        </div>
        <p className="disclaimer">{t("chat.disclaimer")}</p>
      </footer>
    </main>
  );
}
