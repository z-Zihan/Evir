import { useTranslation } from "react-i18next";
import { MessageSquarePlus, Moon, Settings2, Sun, Trash2 } from "lucide-react";
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
  const provider = getDefaultProvider();

  const handleNewChat = () => {
    if (provider) void createConversation(provider.id, provider.modelId);
    else onOpenSettings();
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
      <div className="section-label">{t("sidebar.recent")}</div>
      {conversations.length === 0 ? (
        <div className="empty-list">{t("sidebar.noConversations")}</div>
      ) : (
        <div className="conversation-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item${conv.id === currentConversationId ? " active" : ""}`}
              onClick={() => void selectConversation(conv.id)}
            >
              <span className="conversation-title">{conv.title || t("chat.title")}</span>
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
