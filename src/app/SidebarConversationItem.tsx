import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Pin, Trash2 } from "lucide-react";
import type { ConversationRecord } from "../core/storage/db";

interface SidebarConversationItemProps {
  conversation: ConversationRecord;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
  /** Extra class for nesting depth (project threads indent). */
  variant?: "chat" | "thread";
}

export const SidebarConversationItem = memo(function SidebarConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  variant = "chat",
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
      className={`conversation-item group${variant === "thread" ? " project-thread" : ""}${isActive ? " active" : ""}${conversation.pinned ? " pinned" : ""}`}
      onClick={() => {
        if (!renaming) onSelect();
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
        <span className="conversation-title">{conversation.title || t("chat.title")}</span>
      )}
      {!renaming && (
        <div className="conversation-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className="conversation-action-btn"
            type="button"
            aria-label={conversation.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
            title={conversation.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
            onClick={onTogglePin}
          >
            <Pin size={13} />
          </button>
          <button
            className="conversation-action-btn"
            type="button"
            aria-label={t("sidebar.rename")}
            title={t("sidebar.rename")}
            onClick={() => {
              setRenaming(true);
              setValue(conversation.title);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="conversation-action-btn conversation-delete"
            type="button"
            aria-label={t("provider.delete")}
            title={t("provider.delete")}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
});
