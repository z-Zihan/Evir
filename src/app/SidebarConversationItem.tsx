import { logger } from "../core/logging/logger";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ellipsis, Pencil, Pin, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tip,
} from "../components/ui";
import { cn } from "../components/ui/utils";
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

const STATUS_DOT_CLASS: Record<ConversationRunStatus, string> = {
  preparing: "bg-warning animate-pulse",
  streaming: "bg-success animate-pulse",
  approval: "bg-warning animate-pulse",
  "waiting-user": "bg-primary",
  failed: "bg-danger",
  stopped: "bg-muted",
  unread: "bg-primary",
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
    <span
      className={`conversation-status conversation-status-${status} flex shrink-0 items-center gap-1`}
    >
      <span
        className={cn(
          "conversation-status-dot size-1.5 shrink-0 rounded-full",
          STATUS_DOT_CLASS[status],
        )}
        aria-hidden="true"
      />
      {showLabel && (
        <span className="conversation-status-label text-[10px] font-medium text-muted">
          {t(labelKey)}
        </span>
      )}
    </span>
  );
}

/**
 * Secondary actions live in one `•••` menu (§sidebar-more-menu): the row keeps
 * icon / title / status only. The trigger occupies its layout slot at all
 * times (opacity toggles on hover/focus-within), so revealing it never shifts
 * the row. Rename re-opens the inline input; delete still flows through the
 * shared confirmation dialog in Sidebar.
 */
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

  const beginRename = () => {
    setValue(conversation.title);
    setRenaming(true);
  };

  const hasLiveRun = status === "streaming" || status === "preparing";

  return (
    <div
      className={cn(
        "conversation-item group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg py-[5px] pr-1 pl-2.5 text-[12px] transition-colors select-none",
        variant === "thread" && "project-thread text-[11.5px]",
        isActive ? "active bg-surface-hover font-medium" : "hover:bg-surface-hover/70",
        conversation.pinned && "pinned",
        hasLiveRun && "has-live-run",
      )}
      onClick={() => {
        if (!renaming) {
          logger.info("ui", "ui.sidebar.task-open", {
            actionId: crypto.randomUUID(),
            conversationId: conversation.id,
          });
          onSelect();
        }
      }}
      onDoubleClick={() => beginRename()}
    >
      {conversation.pinned ? (
        <Pin size={11} className="pin-indicator shrink-0 text-primary/70" aria-hidden="true" />
      ) : null}
      {renaming ? (
        <Input
          className="rename-input h-6 px-1.5 text-[12px]"
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
          <span className="conversation-title min-w-0 flex-1 truncate">
            {conversation.title || t("chat.title")}
          </span>
        </Tip>
      )}
      {!renaming && status && <StatusMark status={status} />}
      {!renaming && (
        <div
          className="conversation-actions flex shrink-0 items-center opacity-0 pointer-events-none transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("sidebar.more")}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Ellipsis size={13} />
                </Button>
              }
            />
            <DropdownMenuContent side="bottom" align="end" className="min-w-40">
              <DropdownMenuItem onClick={onTogglePin}>
                <Pin aria-hidden="true" />
                {conversation.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={beginRename}>
                <Pencil aria-hidden="true" />
                {t("sidebar.rename")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 aria-hidden="true" />
                {t("provider.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
});
