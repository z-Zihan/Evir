import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, GitBranch, Pencil, RotateCcw } from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageRecord } from "../core/storage/db";
import { AgentActivity } from "./AgentActivity";

interface ChatMessageProps {
  message: MessageRecord;
  disabled: boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onBranch: (messageId: string) => void;
}

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const code = typeof children === "string" ? children : JSON.stringify(children);
  return (
    <div className="code-block">
      <button
        type="button"
        className="code-block-copy"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={t("chat.copyCode")}
      >
        <Copy size={13} />
        {copied ? t("chat.copied") : t("chat.copyCode")}
      </button>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export function ChatMessage({
  message,
  disabled,
  onEdit,
  onRegenerate,
  onBranch,
}: ChatMessageProps) {
  const { t, i18n } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(message.content);
  useEffect(() => {
    if (!isEditing) setDraft(message.content);
  }, [message.content, isEditing]);
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

  const roleLabel = message.role === "assistant" ? "Evir" : t("chat.you");

  return (
    <article className={`message-row message-${message.role}`}>
      <div className="message-rail" aria-hidden="true">
        <span className="message-role-mark">{message.role === "assistant" ? "E" : "Y"}</span>
        <span className="message-rail-line" />
      </div>
      <div className="message-main">
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
          ) : message.role === "assistant" ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className: cn, children: ch, ...props }) {
                  const isInline = !cn;
                  if (isInline) return <code {...props}>{ch}</code>;
                  return <CodeBlock className={cn}>{ch}</CodeBlock>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : (
            <p>{message.content}</p>
          )}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <AgentActivity toolCalls={message.toolCalls} toolResults={message.toolResults ?? []} />
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
        {!isEditing && message.role !== "system" && (
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
            {message.role === "assistant" ? (
              <button type="button" onClick={() => void onRegenerate()} disabled={disabled}>
                <RotateCcw size={14} />
                {t("chat.regenerate")}
              </button>
            ) : (
              <button type="button" onClick={() => setIsEditing(true)} disabled={disabled}>
                <Pencil size={14} />
                {t("chat.edit")}
              </button>
            )}
            <button
              type="button"
              onClick={() => onBranch(message.id)}
              disabled={disabled}
              aria-label={t("chat.branchFromHere")}
            >
              <GitBranch size={14} />
              {t("chat.branchFromHere")}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
