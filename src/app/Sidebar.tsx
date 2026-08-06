import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, MessageSquarePlus, Pencil, Pin, Settings2, Trash2 } from "lucide-react";
import type { PersonalizationPreferences } from "../core/personalization/types";
import { isMac } from "../core/shortcuts/platform";
import { useChatStore } from "../features/chat/chat-store";
import { loadPersonalizationPreferences } from "../features/settings/personalization-settings";
import type { SettingsTab } from "./SettingsModal";
import { useConfirmationDialog } from "./useConfirmationDialog";

interface SidebarProps {
  onOpenSettings: (tab?: SettingsTab) => void;
  onNewConversation: () => void;
}

export function Sidebar({ onOpenSettings, onNewConversation }: SidebarProps) {
  const { t } = useTranslation();
  const {
    conversations,
    currentConversationId,
    selectConversation,
    deleteConversation,
    renameConversation,
    togglePin,
  } = useChatStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [identity, setIdentity] = useState<
    Pick<PersonalizationPreferences, "displayName" | "avatarColor" | "avatarImage">
  >({ displayName: "", avatarColor: "sage", avatarImage: "" });
  const committingRef = useRef(false);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    let mounted = true;
    const loadIdentity = () => {
      void loadPersonalizationPreferences().then((preferences) => {
        if (mounted) setIdentity(preferences);
      });
    };
    loadIdentity();
    window.addEventListener("evir:personalization-updated", loadIdentity);
    return () => {
      mounted = false;
      window.removeEventListener("evir:personalization-updated", loadIdentity);
    };
  }, []);

  const shortcutModifier = isMac() ? "⌘" : "Ctrl+";
  const localName = identity.displayName.trim() || t("chat.localUser");
  const localInitial = Array.from(localName)[0] ?? "•";
  const pinned = conversations
    .filter((item) => item.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const unpinned = conversations
    .filter((item) => !item.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const handleCommitRename = () => {
    if (committingRef.current) return;
    committingRef.current = true;
    if (renamingId) void renameConversation(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue("");
    committingRef.current = false;
  };

  const renderConversation = (conversation: (typeof conversations)[number]) => {
    const isActive = conversation.id === currentConversationId;
    const isRenaming = renamingId === conversation.id;
    return (
      <div
        key={conversation.id}
        className={`conversation-item group${isActive ? " active" : ""}${conversation.pinned ? " pinned" : ""}`}
        onClick={() => {
          if (!isRenaming) void selectConversation(conversation.id);
        }}
        onDoubleClick={() => {
          setRenamingId(conversation.id);
          setRenameValue(conversation.title);
        }}
      >
        {conversation.pinned ? (
          <Pin size={12} className="pin-indicator" aria-hidden="true" />
        ) : null}
        {isRenaming ? (
          <input
            className="rename-input"
            type="text"
            value={renameValue}
            autoFocus
            maxLength={100}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={handleCommitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleCommitRename();
              if (event.key === "Escape") {
                setRenamingId(null);
                setRenameValue("");
              }
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="conversation-title">{conversation.title || t("chat.title")}</span>
        )}
        {!isRenaming && (
          <div className="conversation-actions" onClick={(event) => event.stopPropagation()}>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={conversation.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              onClick={() => void togglePin(conversation.id)}
            >
              <Pin size={13} />
            </button>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={t("sidebar.rename")}
              onClick={() => {
                setRenamingId(conversation.id);
                setRenameValue(conversation.title);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="conversation-action-btn conversation-delete"
              type="button"
              aria-label={t("provider.delete")}
              onClick={() => {
                requestConfirmation(
                  {
                    title: t("confirmation.deleteTitle"),
                    description: t("confirmation.deleteDescription", {
                      item: conversation.title || t("chat.title"),
                    }),
                    confirmLabel: t("provider.delete"),
                  },
                  () => deleteConversation(conversation.id),
                );
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <img src="/evir-mark.svg" alt="" />
          </div>
          <div className="brand-lockup">
            <strong className="brand-name">Evir</strong>
            <span className="brand-caption">{t("sidebar.localAi")}</span>
          </div>
        </div>
        <button className="new-chat-button" type="button" onClick={onNewConversation}>
          <MessageSquarePlus size={16} /> {t("sidebar.newChat")}
          <span className="new-chat-shortcut" aria-hidden="true">
            {shortcutModifier}N
          </span>
        </button>
        {pinned.length > 0 && (
          <>
            <div className="section-label">{t("sidebar.pinned")}</div>
            <div className="conversation-list pinned-list">{pinned.map(renderConversation)}</div>
          </>
        )}
        <div className="section-label">{t("sidebar.recent")}</div>
        {conversations.length === 0 ? (
          <div className="empty-list">{t("sidebar.noConversations")}</div>
        ) : (
          <div className="conversation-list">{unpinned.map(renderConversation)}</div>
        )}
        <div className="sidebar-footer">
          <button
            className="sidebar-identity"
            type="button"
            onClick={() => onOpenSettings("identity")}
            aria-label={t("sidebar.editIdentity")}
          >
            <span className={`sidebar-identity-avatar avatar-${identity.avatarColor}`}>
              {identity.avatarImage ? <img src={identity.avatarImage} alt="" /> : localInitial}
            </span>
            <span className="sidebar-identity-copy">
              <strong>{localName}</strong>
              <small>{t("sidebar.localIdentity")}</small>
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <button
            className="settings-button"
            type="button"
            onClick={() => onOpenSettings()}
            aria-label={t("settings.title")}
          >
            <Settings2 size={17} />
            <span>{t("settings.title")}</span>
            <span className="settings-shortcut" aria-hidden="true">
              {shortcutModifier},
            </span>
          </button>
        </div>
      </aside>
      {confirmationDialog}
    </>
  );
}
