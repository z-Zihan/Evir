import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, Square, X } from "lucide-react";
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
  const { t, i18n } = useTranslation();
  const {
    messages,
    isStreaming,
    streamingContent,
    error,
    sendMessage,
    stopGeneration,
    pendingAttachments,
    addAttachment,
    removeAttachment,
  } = useChatStore();
  const { getDefaultProvider } = useProviderStore();
  const provider = getDefaultProvider();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingContent]);

  const displayError = (value: string) => (i18n.exists(value) ? t(value) : value);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    for (const file of files) {
      void addAttachment(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

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
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="message-attachments">
                      {msg.attachments.map((att) =>
                        att.type === "image" ? (
                          <img
                            key={att.id}
                            src={att.data}
                            alt={att.fileName}
                            className="message-attachment-image"
                          />
                        ) : (
                          <span key={att.id} className="message-attachment-file">
                            {att.fileName}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {msg.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                  {msg.status === "stopped" && (
                    <span className="message-stopped">({t("chat.stopped")})</span>
                  )}
                  {msg.status === "error" && msg.errorMessage && (
                    <div className="message-error">{displayError(msg.errorMessage)}</div>
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
      {error && <div className="chat-error">{displayError(error)}</div>}
      <footer className="composer-wrap">
        <div
          className={`composer${dragOver ? " drag-over" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {pendingAttachments.length > 0 && (
            <div className="pending-attachments">
              {pendingAttachments.map((att) =>
                att.type === "image" ? (
                  <div key={att.id} className="pending-attachment-chip">
                    <img src={att.data} alt={att.fileName} className="pending-attachment-thumb" />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={t("chat.removeAttachment")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div key={att.id} className="pending-attachment-chip">
                    <span className="pending-attachment-name">{att.fileName}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={t("chat.removeAttachment")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
          <textarea
            aria-label={t("chat.placeholder")}
            placeholder={t("chat.placeholder")}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <div className="composer-footer">
            <span>
              <button
                type="button"
                className="attach-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                aria-label={t("chat.attachFile")}
              >
                <Paperclip size={16} />
              </button>
              <span className="model-label">{provider.modelId}</span>
            </span>
            {isStreaming ? (
              <button type="button" className="stop-button" onClick={stopGeneration}>
                <Square size={14} />
                {t("chat.stop")}
              </button>
            ) : (
              <button
                type="button"
                disabled={!input.trim() && pendingAttachments.length === 0}
                onClick={onSendMessage}
              >
                {t("chat.send")}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFileSelect(e.target.files)}
            accept="image/*,text/*,.md,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.csv,.sh,.bash,.sql"
          />
        </div>
        <p className="disclaimer">{t("chat.disclaimer")}</p>
      </footer>
    </main>
  );
}
