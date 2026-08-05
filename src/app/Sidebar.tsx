import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, MessageSquarePlus, Moon, Search, Settings2, Sun, Trash2 } from "lucide-react";
import { useChatStore } from "../features/chat/chat-store";
import { useProviderStore } from "../features/provider/provider-store";
import { useThemeStore } from "../features/settings/theme-store";

interface SidebarProps {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const {
    conversations,
    currentConversationId,
    selectConversation,
    deleteConversation,
    createConversation,
  } = useChatStore();
  const { getDefaultProvider } = useProviderStore();
  const { resolvedTheme, cycleTheme } = useThemeStore();
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = () => searchRef.current?.focus();
    window.addEventListener("evir:focus-search", focusSearch);
    return () => window.removeEventListener("evir:focus-search", focusSearch);
  }, []);
  const provider = getDefaultProvider();
  const filteredConversations = conversations.filter(({ title }) =>
    title.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const handleNewChat = () => {
    if (provider) void createConversation(provider.id, provider.modelId);
    else onOpenSettings();
  };

  const handleSelectConversation = (id: string) => {
    setSearchQuery("");
    void selectConversation(id);
  };

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark">E</div>
        <strong>Evir</strong>
      </div>
      <button className="primary-action" type="button" onClick={handleNewChat}>
        <MessageSquarePlus size={16} />
        {t("sidebar.newChat")}
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
      <div className="section-label">{t("sidebar.recent")}</div>
      {conversations.length === 0 ? (
        <div className="empty-list">{t("sidebar.noConversations")}</div>
      ) : filteredConversations.length === 0 ? (
        <div className="empty-list">{t("sidebar.noResults")}</div>
      ) : (
        <div className="conversation-list">
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item${conv.id === currentConversationId ? " active" : ""}`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              <span className="conversation-title">
                {conv.title || t("chat.title")}
                {conv.parentConversationId && (
                  <span className="conversation-branch-indicator">
                    <GitBranch size={11} />
                    {t("chat.branched")}
                  </span>
                )}
              </span>
              <button
                className="conversation-delete"
                type="button"
                aria-label={t("provider.delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteConversation(conv.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="sidebar-footer">
        <button
          className="icon-button"
          type="button"
          onClick={cycleTheme}
          aria-label={t("settings.theme")}
        >
          {resolvedTheme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
        </button>
        <button
          className="language-button"
          type="button"
          onClick={() => void i18n.changeLanguage(i18n.language.startsWith("zh") ? "en" : "zh-CN")}
        >
          {i18n.language.startsWith("zh") ? "EN" : "中"}
        </button>
        <button
          className="icon-button"
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
