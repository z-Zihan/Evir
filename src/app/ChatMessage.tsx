import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Pencil, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageRecord } from "../core/storage/db";
import { ToolCallCard } from "./ToolCallCard";

interface ChatMessageProps {
  message: MessageRecord;
  disabled: boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onBranch: (messageId: string) => void;
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

  return (
    <div className={`message message-${message.role}`}>
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
                className="message-edit-save"
                onClick={saveEdit}
                disabled={!canSave}
              >
                {t("chat.save")}
              </button>
            </div>
          </div>
        ) : message.role === "assistant" ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        ) : (
          <p>{message.content}</p>
        )}
        {message.toolCalls?.map((call) => {
          const result = message.toolResults?.find((item) => item.toolCallId === call.id);
          return <ToolCallCard key={call.id} call={call} {...(result ? { result } : {})} />;
        })}
        {message.status === "stopped" && (
          <span className="message-stopped">({t("chat.stopped")})</span>
        )}
        {message.status === "error" && message.errorMessage && (
          <div className="message-error">{displayError(message.errorMessage)}</div>
        )}
      </div>
      {!isEditing && message.role !== "system" && (
        <div className="message-actions">
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
          <button type="button" onClick={() => onBranch(message.id)} disabled={disabled}>
            <GitBranch size={14} />
            {t("chat.branch")}
          </button>
        </div>
      )}
    </div>
  );
}
