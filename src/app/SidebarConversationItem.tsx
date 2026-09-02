import { logger } from "../core/logging/logger";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Pin, Trash2 } from "lucide-react";
import { Button, Tip } from "../components/ui";
import type { ConversationRecord } from "../core/storage/db";
import type { ConversationRunStatus } from "./useConversationStatus";

interface SidebarConversationItemProps {
  conversation: ConversationRecord;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
  /** Extra class for nesting depth (project threads indent). */
  variant?: "chat" | "thread";
  /** Live run status for this row (running / approval / failed / unread). */
  status?: ConversationRunStatus | null;
}

const STATUS_LABEL_KEY: Record<ConversationRunStatus, string> = {
  preparing: "sidebar.statusPreparing",
  streaming: "sidebar.statusRunning",
  approval: "sidebar.statusApproval",
  "waiting-user": "sidebar.statusWaitingUser",
  failed: "sidebar.statusFailed",
  stopped: "sidebar.statusStopped",
  unread: "sidebar.statusUnread",
};

/**
 * Restrained live status mark: a small dot plus an optional one-word label.
 * Running dots pulse; approval uses amber; failures red; unread a plain dot.
 */
function StatusMark({ status }: { status: ConversationRunStatus }) {
  const { t } = useTranslation();
  const labelKey = STATUS_LABEL_KEY[status];
  const showLabel =
    status === "preparing" ||
    status === "streaming" ||
    status === "approval" ||
    status === "waiting-user";
  return (
    <span className={`conversation-status conversation-status-${status}`}>
      <span className="conversation-status-dot" aria-hidden="true" />
      {showLabel && <span className="conversation-status-label">{t(labelKey)}</span>}
    </span>
  );
}

export const SidebarConversationItem = memo(function SidebarConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  variant = "chat",
  status = null,
}: SidebarConversationItemProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(conversation.title);

  const commitRename = () => {
    setRenaming(false);
    if (value.trim() && value !== conversation.title) onRename(value.trim());
    setValue(conversation.title);
  };

  return (
    <div
      className={`conversation-item group${variant === "thread" ? " project-thread" : ""}${isActive ? " active" : ""}${conversation.pinned ? " pinned" : ""}${status === "streaming" || status === "preparing" ? " has-live-run" : ""}`}
      onClick={() => {
        if (!renaming) {
          logger.info("ui", "ui.sidebar.task-open", {
            actionId: crypto.randomUUID(),
            conversationId: conversation.id,
          });
          onSelect();
        }
      }}
      onDoubleClick={() => {
        setRenaming(true);
        setValue(conversation.title);
      }}
    >
      {conversation.pinned ? <Pin size={12} className="pin-indicator" aria-hidden="true" /> : null}
      {renaming ? (
        <input
          className="rename-input"
          type="text"
          value={value}
          autoFocus
          maxLength={100}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              setRenaming(false);
              setValue(conversation.title);
            }
          }}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <Tip content={conversation.title || t("chat.title")}>
          <span className="conversation-title">{conversation.title || t("chat.title")}</span>
        </Tip>
      )}
      {!renaming && status && <StatusMark status={status} />}
      {!renaming && (
        <div className="conversation-actions" onClick={(event) => event.stopPropagation()}>
          <Tip content={conversation.pinned ? t("sidebar.unpin") : t("sidebar.pin")}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={conversation.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              onClick={onTogglePin}
            >
              <Pin size={13} />
            </Button>
          </Tip>
          <Tip content={t("sidebar.rename")}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("sidebar.rename")}
              onClick={() => {
                setRenaming(true);
                setValue(conversation.title);
              }}
            >
              <Pencil size={13} />
            </Button>
          </Tip>
          <Tip content={t("provider.delete")}>
            <Button
              variant="ghost"
              size="icon-xs"
              className="conversation-delete"
              aria-label={t("provider.delete")}
              onClick={onDelete}
            >
              <Trash2 size={14} />
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
});
