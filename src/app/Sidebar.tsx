import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, MessageSquarePlus, Pin, Search, Settings2, Trash2 } from "lucide-react";
import { useChatStore } from "../features/chat/chat-store";
import { useProviderStore } from "../features/provider/provider-store";
import { isMac } from "../core/shortcuts/platform";

interface SidebarProps {
  onOpenSettings: () => void;
  focusSearchRef: React.RefObject<(() => void) | null>;
}

export function Sidebar({ onOpenSettings, focusSearchRef }: SidebarProps) {
  const { t } = useTranslation();
  const {
    conversations,
    currentConversationId,
    selectConversation,
    deleteConversation,
    createConversation,
    renameConversation,
    togglePin,
  } = useChatStore();
  const { getDefaultProvider } = useProviderStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const committingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focusSearchRef.current = () => searchRef.current?.focus();
    return () => {
      focusSearchRef.current = null;
    };
  }, [focusSearchRef]);

  const provider = getDefaultProvider();
  const shortcutModifier = isMac() ? "⌘" : "Ctrl+";

  const filteredConversations = conversations.filter(({ title }) =>
    title.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const pinned = filteredConversations
    .filter((c) => c.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const unpinned = filteredConversations
    .filter((c) => !c.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const handleNewChat = () => {
    if (provider) void createConversation(provider.id, provider.modelId);
    else onOpenSettings();
  };

  const handleSelectConversation = (id: string) => {
    if (renamingId !== null) return;
    setSearchQuery("");
    void selectConversation(id);
  };

  const handleStartRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const handleCommitRename = () => {
    if (committingRef.current) return;
    committingRef.current = true;
    const id = renamingId;
    if (id) {
      void renameConversation(id, renameValue);
    }
    setRenamingId(null);
    setRenameValue("");
    committingRef.current = false;
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCommitRename();
    } else if (e.key === "Escape") {
      setRenamingId(null);
      setRenameValue("");
    }
  };

  const renderConversation = (conv: (typeof conversations)[number]) => {
    const isActive = conv.id === currentConversationId;
    const isRenaming = renamingId === conv.id;

    return (
      <div
        key={conv.id}
        className={`conversation-item group${isActive ? " active" : ""}${conv.pinned ? " pinned" : ""}`}
        onClick={() => handleSelectConversation(conv.id)}
        onDoubleClick={() => handleStartRename(conv.id, conv.title)}
      >
        {conv.pinned && <Pin size={12} className="pin-indicator" aria-hidden="true" />}
        {isRenaming ? (
          <input
            className="rename-input"
            type="text"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={100}
            onBlur={handleCommitRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="conversation-title">{conv.title || t("chat.title")}</span>
        )}
        {!isRenaming && (
          <div className="conversation-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              title={conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              onClick={() => void togglePin(conv.id)}
            >
              <Pin size={13} />
            </button>
            <button
              className="conversation-action-btn"
              type="button"
              aria-label={t("sidebar.rename")}
              title={t("sidebar.rename")}
              onClick={() => handleStartRename(conv.id, conv.title)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="conversation-action-btn conversation-delete"
              type="button"
              aria-label={t("provider.delete")}
              onClick={() => {
                if (window.confirm(t("sidebar.confirmDelete"))) void deleteConversation(conv.id);
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
      <button className="new-chat-button" type="button" onClick={handleNewChat}>
        <MessageSquarePlus size={16} />
        {t("sidebar.newChat")}
        <span className="new-chat-shortcut" aria-hidden="true">
          {shortcutModifier}N
        </span>
      </button>
      <label className="conversation-search">
        <Search size={15} />
        <input
          ref={searchRef}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("sidebar.searchPlaceholder")}
          aria-label={t("sidebar.searchPlaceholder")}
        />
      </label>
      {pinned.length > 0 && (
        <>
          <div className="section-label">{t("sidebar.pinned")}</div>
          <div className="conversation-list pinned-list">{pinned.map(renderConversation)}</div>
        </>
      )}
      <div className="section-label">{t("sidebar.recent")}</div>
      {conversations.length === 0 ? (
        <div className="empty-list">{t("sidebar.noConversations")}</div>
      ) : filteredConversations.length === 0 ? (
        <div className="empty-list">{t("sidebar.noResults")}</div>
      ) : (
        <div className="conversation-list">{unpinned.map(renderConversation)}</div>
      )}
      <div className="sidebar-footer">
        <button
          className="settings-button"
          type="button"
          onClick={onOpenSettings}
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
  );
}
