import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Copy, Pencil, RotateCcw, Sparkles } from "lucide-react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageRail,
  MessageRoleMark,
  MessageState,
} from "../components/ai";
import { Button, Textarea } from "../components/ui";
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
  const role = isAssistant ? "assistant" : message.role === "system" ? "system" : "user";
  const roleLabel = isAssistant ? "Evir" : localUserName;
  const localInitial = Array.from(localUserName.trim())[0]?.toLocaleUpperCase(i18n.language) ?? "•";
  // Assistant rows keep Evir's left role rail (AI Elements Message is
  // column-direction; flex-row restores the rail + content line).
  const messageClass =
    role === "user"
      ? `${groupedWithPrevious ? "message-grouped " : ""}${groupedWithNext ? "message-group-continues " : ""}py-1.5`
      : `flex-row items-start ${groupedWithPrevious ? "message-grouped " : ""}${groupedWithNext ? "message-group-continues " : ""}py-1.5`;

  return (
    <Message from={role} className={`message-row message-${role} ${messageClass}`}>
      {role === "user" ? (
        <div className="message-main flex min-w-0 flex-col items-end gap-1">
          {!groupedWithPrevious && (
            <header className="message-header flex h-5 items-center gap-2 text-[11px] text-muted">
              <time className="text-muted" dateTime={new Date(message.createdAt).toISOString()}>
                {new Date(message.createdAt).toLocaleTimeString(i18n.language, {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </time>
              <span className="message-author font-medium text-foreground/85">{roleLabel}</span>
            </header>
          )}
          <MessageContent className="message-content max-w-[min(560px,88%)]">
            {message.activeSkills && message.activeSkills.length > 0 && (
              <div
                className="mb-1 flex items-center justify-end gap-1.5 text-[11px] text-muted"
                aria-label={t("chat.skillsUsed")}
              >
                <Sparkles size={11} aria-hidden="true" />
                <span>{t("chat.skillsUsed")}</span>
                {message.activeSkills.map((skill) => (
                  <span
                    key={skill.id}
                    className="rounded-md border border-border bg-surface px-1.5 py-px text-[10.5px]"
                  >
                    {skill.name}
                  </span>
                ))}
              </div>
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                {message.attachments.map((attachment) =>
                  attachment.type === "image" ? (
                    <img
                      key={attachment.id}
                      src={attachment.data}
                      alt={attachment.fileName}
                      className="max-h-40 rounded-lg border border-border"
                    />
                  ) : (
                    <span
                      key={attachment.id}
                      className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted"
                    >
                      {attachment.fileName}
                    </span>
                  ),
                )}
              </div>
            )}
            {isEditing ? (
              <div className="flex w-[min(560px,80vw)] flex-col gap-2 text-left">
                <Textarea
                  aria-label={t("chat.edit")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoFocus
                  rows={3}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={cancelEdit}>
                    {t("chat.cancel")}
                  </Button>
                  <Button variant="primary" size="sm" onClick={saveEdit} disabled={!canSave}>
                    {t("chat.save")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-left">{message.content}</p>
            )}
          </MessageContent>
          {!isEditing && !groupedWithNext && (
            <MessageActions className="justify-end">
              <MessageAction
                tooltip={copied ? t("chat.copied") : t("chat.copyMessage")}
                aria-label={t("chat.copyMessage")}
                onClick={() => {
                  void navigator.clipboard.writeText(message.content).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                <Copy size={13} />
              </MessageAction>
              {onRemember && (
                <MessageAction
                  tooltip={
                    rememberState === "saved"
                      ? t("chat.remembered")
                      : rememberState === "error"
                        ? t("chat.rememberFailed")
                        : t("chat.remember")
                  }
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
                  <Brain size={13} />
                </MessageAction>
              )}
              <MessageAction
                tooltip={t("chat.edit")}
                disabled={disabled}
                onClick={() => setIsEditing(true)}
                aria-label={t("chat.edit")}
              >
                <Pencil size={13} />
              </MessageAction>
            </MessageActions>
          )}
        </div>
      ) : (
        <>
          <MessageRail>
            {!groupedWithPrevious && (
              <MessageRoleMark>
                {isAssistant ? (
                  <img src="/evir-mark.svg" alt="" className="size-full" />
                ) : localUserAvatar ? (
                  <img src={localUserAvatar} alt="" className="size-full object-cover" />
                ) : (
                  localInitial
                )}
              </MessageRoleMark>
            )}
          </MessageRail>
          <div className="message-main flex min-w-0 max-w-full flex-1 flex-col gap-1">
            {!groupedWithPrevious && (
              <header className="message-header flex h-5 items-center gap-2 text-[11px] text-muted">
                <span className="message-author font-medium text-foreground/85">{roleLabel}</span>
                <time className="text-muted" dateTime={new Date(message.createdAt).toISOString()}>
                  {new Date(message.createdAt).toLocaleTimeString(i18n.language, {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </time>
              </header>
            )}
            <MessageContent className="message-content w-full">
              {message.activeSkills && message.activeSkills.length > 0 && (
                <div
                  className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted"
                  aria-label={t("chat.skillsUsed")}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span>{t("chat.skillsUsed")}</span>
                  {message.activeSkills.map((skill) => (
                    <span
                      key={skill.id}
                      className="rounded-md border border-border bg-surface px-1.5 py-px text-[11px]"
                    >
                      {skill.name}
                    </span>
                  ))}
                </div>
              )}
              {isAssistant ? (
                <MarkdownContent content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <AgentActivity
                  toolCalls={message.toolCalls}
                  toolResults={message.toolResults ?? []}
                  messageStatus={message.status}
                  failedRetryCount={failedRetryCount}
                />
              )}
              {message.status === "stopped" && <MessageState>{t("chat.stopped")}</MessageState>}
              {message.status === "error" && message.errorMessage && (
                <MessageState tone="error">
                  {displayError(message.errorMessage)}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] font-normal"
                    onClick={() => void onRegenerate()}
                    disabled={disabled}
                  >
                    <RotateCcw size={12} />
                    {t("chat.retry")}
                  </Button>
                </MessageState>
              )}
            </MessageContent>
            {!isEditing && !groupedWithNext && (
              <MessageActions>
                <MessageAction
                  tooltip={t("chat.copyMessage")}
                  aria-label={t("chat.copyMessage")}
                  onClick={() => {
                    void navigator.clipboard.writeText(message.content).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  <Copy size={13} />
                </MessageAction>
                {isAssistant && (
                  <MessageAction
                    tooltip={t("chat.regenerate")}
                    disabled={disabled}
                    onClick={() => void onRegenerate()}
                    aria-label={t("chat.regenerate")}
                  >
                    <RotateCcw size={13} />
                  </MessageAction>
                )}
              </MessageActions>
            )}
          </div>
        </>
      )}
    </Message>
  );
}
