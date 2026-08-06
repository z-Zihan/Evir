import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, GitBranch, MessageSquarePlus, Pin, Search, Settings2, Trash2 } from "lucide-react";
import { useChatStore } from "../features/chat/chat-store";
import { useProviderStore } from "../features/provider/provider-store";

interface SidebarProps {
  onOpenSettings: () => void;
  focusSearchRef: React.RefObject<(() => void) | null>;
}

export function Sidebar({ onOpenSettings, focusSearchRef }: SidebarProps) {
  const { t, i18n } = useTranslation();
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

  const { privateSession, togglePrivateSession } = useChatStore();
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
        className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition relative${isActive ? " active" : ""}${conv.pinned ? " pinned" : ""}`}
        onClick={() => handleSelectConversation(conv.id)}
        onDoubleClick={() => handleStartRename(conv.id, conv.title)}
      >
        {conv.pinned && <Pin size={11} className="pin-indicator" />}
        {isRenaming ? (
          <input
            className="flex-1 border border-primary rounded px-2 py-0.5 text-sm bg-surface outline-none"
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
          <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
            {conv.title || t("chat.title")}
            {conv.parentConversationId && (
              <span className="conversation-branch-indicator">
                <GitBranch size={11} />
                {t("chat.branched")}
              </span>
            )}
          </span>
        )}
        {!isRenaming && (
          <div
            className={`hidden group-hover:flex gap-1 flex-shrink-0${isActive ? " flex" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
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
              className=""
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
    <aside className="flex flex-col min-h-screen p-3 border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-1.5 pb-4">
        <div className="grid place-items-center w-7 h-7 rounded-lg bg-primary text-primary-fg font-bold text-sm">
          E
        </div>
        <strong>Evir</strong>
      </div>
      <button
        className="flex items-center justify-center gap-2 min-h-[38px] rounded-lg font-semibold border border-border bg-surface hover:bg-surface-hover transition"
        type="button"
        onClick={handleNewChat}
      >
        <MessageSquarePlus size={16} />
        {t("sidebar.newChat")}
      </button>
      <label className="flex items-center gap-2 mb-2 px-3 py-2 border border-border rounded-lg bg-surface">
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
          <div className="text-xs font-semibold uppercase tracking-wider text-muted px-2 pt-3 pb-1">
            {t("sidebar.pinned")}
          </div>
          <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {pinned.map(renderConversation)}
          </div>
        </>
      )}
      <div className="text-xs font-semibold uppercase tracking-wider text-muted px-2 pt-3 pb-1">
        {t("sidebar.recent")}
      </div>
      {conversations.length === 0 ? (
        <div className="text-muted text-sm px-2 py-4 text-center">
          {t("sidebar.noConversations")}
        </div>
      ) : filteredConversations.length === 0 ? (
        <div className="text-muted text-sm px-2 py-4 text-center">{t("sidebar.noResults")}</div>
      ) : (
        <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
          {unpinned.map(renderConversation)}
        </div>
      )}
      <div className="flex gap-1 pt-3 border-t border-border mt-2">
        <button
          className={`grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition${privateSession ? " active" : ""}`}
          type="button"
          onClick={togglePrivateSession}
          aria-label={t("chat.privateSession")}
        >
          {privateSession ? "🔒" : "🔓"}
        </button>

        <button
          className="language-button"
          type="button"
          onClick={() => void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")}
        >
          {i18n.language.startsWith("zh") ? "EN" : "中"}
        </button>
        <button
          className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-surface-hover hover:text-foreground transition"
          type="button"
          onClick={onOpenSettings}
          aria-label={t("settings.title")}
        >
          <Settings2 size={17} />
        </button>
      </div>
      {provider && (
        <div className="provider-indicator">
          {provider.name} · {provider.modelId}
        </div>
      )}
    </aside>
  );
}
