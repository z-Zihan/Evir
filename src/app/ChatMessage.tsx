import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, GitBranch, Pencil, RotateCcw } from "lucide-react";

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

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = typeof children === "string" ? children : JSON.stringify(children);
  return (
    <div className="relative my-3 rounded-lg overflow-hidden border border-border">
      <button
        type="button"
        className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-1 bg-surface-hover border border-border rounded opacity-0 hover:opacity-100 transition text-muted z-10"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label="Copy code"
      >
        <Copy size={13} />
        {copied ? "Copied!" : "Copy"}
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

  return (
    <div className={`max-w-[780px] mx-auto w-full message-${message.role}`}>
      <div className="message-content">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {message.attachments.map((attachment) =>
              attachment.type === "image" ? (
                <img
                  key={attachment.id}
                  src={attachment.data}
                  alt={attachment.fileName}
                  className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                />
              ) : (
                <span
                  key={attachment.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-surface-hover rounded text-xs"
                >
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
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={cancelEdit}>
                {t("chat.cancel")}
              </button>
              <button
                type="button"
                className="bg-primary text-primary-fg border-primary"
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
        {message.toolCalls?.map((call) => {
          const result = message.toolResults?.find((item) => item.toolCallId === call.id);
          return <ToolCallCard key={call.id} call={call} {...(result ? { result } : {})} />;
        })}
        {message.status === "stopped" && (
          <span className="text-muted text-xs italic">({t("chat.stopped")})</span>
        )}
        {message.status === "error" && message.errorMessage && (
          <div className="text-danger text-sm p-2 bg-danger/8 rounded-lg mt-2">
            {displayError(message.errorMessage)}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs px-2 py-1 mt-2 bg-surface border border-border rounded hover:border-primary hover:text-primary transition"
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
        <div className="flex items-center gap-2 mt-1 px-1">
          <span className="text-xs text-muted opacity-60">
            {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
          <div className="flex gap-1 opacity-0 hover:opacity-100 transition">
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
        </div>
      )}
    </div>
  );
}
