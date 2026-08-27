import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Pencil, RotateCcw, Sparkles, Copy } from "lucide-react";

import type { MessageRecord } from "../core/storage/db";
import { AgentActivity } from "./AgentActivity";
import { MarkdownContent } from "./MarkdownContent";

interface ChatMessageProps {
  message: MessageRecord;
  groupedWithPrevious?: boolean;
  groupedWithNext?: boolean;
  disabled: boolean;
  localUserName: string;
  localUserAvatar: string;
  failedRetryCount?: number | undefined;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onRemember?: (message: MessageRecord) => Promise<void>;
}

export function ChatMessage({
  message,
  groupedWithPrevious = false,
  groupedWithNext = false,
  disabled,
  localUserName,
  localUserAvatar,
  failedRetryCount,
  onEdit,
  onRegenerate,
  onRemember,
}: ChatMessageProps) {
  const { t, i18n } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [rememberState, setRememberState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (!isEditing) setDraft(message.content);
  }, [message.content, isEditing]);
  useEffect(() => setRememberState("idle"), [message.content, message.id]);
  const hasAttachment = Boolean(message.attachments?.length);
  const canSave = draft.trim().length > 0 || hasAttachment;
  const displayError = (value: string) => (i18n.exists(value) ? t(value) : value);

  const cancelEdit = () => {
    setDraft(message.content);
    setIsEditing(false);
  };

  const saveEdit = () => {
    if (!canSave) return;
    setIsEditing(false);
    onEdit(message.id, draft.trim()).catch(() => {
      setIsEditing(true);
    });
  };

  const isAssistant = message.role === "assistant";
  const roleLabel = isAssistant ? "Evir" : localUserName;
  const localInitial = Array.from(localUserName.trim())[0]?.toLocaleUpperCase(i18n.language) ?? "•";

  return (
    <article
      className={`message-row message-${message.role}${groupedWithPrevious ? " message-grouped" : ""}${groupedWithNext ? " message-group-continues" : ""}`}
    >
      <div className="message-rail" aria-hidden="true">
        {!groupedWithPrevious && (
          <span className="message-role-mark">
            {isAssistant ? (
              <img src="/evir-mark.svg" alt="" />
            ) : localUserAvatar ? (
              <img src={localUserAvatar} alt="" />
            ) : (
              localInitial
            )}
          </span>
        )}
      </div>
      <div className="message-main">
        {!groupedWithPrevious && (
          <header className="message-header">
            <span className="message-author">{roleLabel}</span>
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {new Date(message.createdAt).toLocaleTimeString(i18n.language, {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </time>
          </header>
        )}
        <div className="message-content">
          {message.attachments && message.attachments.length > 0 && (
            <div className="message-attachments">
              {message.attachments.map((attachment) =>
                attachment.type === "image" ? (
                  <img
                    key={attachment.id}
                    src={attachment.data}
                    alt={attachment.fileName}
                    className="message-attachment-image"
                  />
                ) : (
                  <span key={attachment.id} className="message-attachment-file">
                    {attachment.fileName}
                  </span>
                ),
              )}
            </div>
          )}
          {message.activeSkills && message.activeSkills.length > 0 && (
            <div className="message-active-skills" aria-label={t("chat.skillsUsed")}>
              <Sparkles size={13} aria-hidden="true" />
              <span>{t("chat.skillsUsed")}</span>
              {message.activeSkills.map((skill) => (
                <span key={skill.id} className="message-active-skill">
                  {skill.name}
                </span>
              ))}
            </div>
          )}
          {isEditing ? (
            <div className="message-edit-form">
              <textarea
                aria-label={t("chat.edit")}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoFocus
              />
              <div className="message-edit-actions">
                <button type="button" onClick={cancelEdit}>
                  {t("chat.cancel")}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={saveEdit}
                  disabled={!canSave}
                >
                  {t("chat.save")}
                </button>
              </div>
            </div>
          ) : isAssistant ? (
            <MarkdownContent content={message.content} />
          ) : (
            <p>{message.content}</p>
          )}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <AgentActivity
              toolCalls={message.toolCalls}
              toolResults={message.toolResults ?? []}
              messageStatus={message.status}
              failedRetryCount={failedRetryCount}
            />
          )}
          {message.status === "stopped" && (
            <span className="message-state message-state-stopped">{t("chat.stopped")}</span>
          )}
          {message.status === "error" && message.errorMessage && (
            <div className="message-state message-state-error">
              {displayError(message.errorMessage)}
              <button
                type="button"
                className="message-retry-button"
                onClick={() => void onRegenerate()}
                disabled={disabled}
              >
                <RotateCcw size={13} />
                {t("chat.retry")}
              </button>
            </div>
          )}
        </div>
        {!isEditing && message.role !== "system" && !groupedWithNext && (
          <div className="message-actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(message.content).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              aria-label={t("chat.copyMessage")}
            >
              <Copy size={14} />
              {copied ? t("chat.copied") : t("chat.copyMessage")}
            </button>
            {isAssistant ? (
              <button type="button" onClick={() => void onRegenerate()} disabled={disabled}>
                <RotateCcw size={14} />
                {t("chat.regenerate")}
              </button>
            ) : (
              <>
                {onRemember && (
                  <button
                    type="button"
                    disabled={disabled || rememberState === "saving" || rememberState === "saved"}
                    onClick={() => {
                      setRememberState("saving");
                      void onRemember(message).then(
                        () => setRememberState("saved"),
                        () => setRememberState("error"),
                      );
                    }}
                    aria-label={t("chat.remember")}
                  >
                    <Brain size={14} />
                    {rememberState === "saving"
                      ? t("chat.remembering")
                      : rememberState === "saved"
                        ? t("chat.remembered")
                        : rememberState === "error"
                          ? t("chat.rememberFailed")
                          : t("chat.remember")}
                  </button>
                )}
                <button type="button" onClick={() => setIsEditing(true)} disabled={disabled}>
                  <Pencil size={14} />
                  {t("chat.edit")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
