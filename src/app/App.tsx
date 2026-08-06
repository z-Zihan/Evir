import { useCallback, useEffect, useState } from "react";
import { useProviderStore } from "../features/provider/provider-store";
import { useChatStore } from "../features/chat/chat-store";
import { useUsageStore } from "../features/usage/usage-store";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { SettingsModal, type SettingsTab } from "./SettingsModal";
import { useShortcuts } from "./useShortcuts";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { useTranslation } from "react-i18next";

export function App() {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(
    () => typeof window === "undefined" || window.innerWidth > 820,
  );
  const [messageInput, setMessageInput] = useState("");
  const { loadProviders, getDefaultProvider } = useProviderStore();
  const { loadConversations, createOrReuseConversation, sendMessage, stopGeneration, isStreaming } =
    useChatStore();
  const loadUsageRecords = useUsageStore((state) => state.loadRecords);

  const handleNewConversation = useCallback(() => {
    const provider = getDefaultProvider();
    if (!provider) {
      setSettingsTab("providers");
      setSettingsOpen(true);
      return;
    }
    const focusComposer = () => window.dispatchEvent(new Event("evir:focus-composer"));
    void createOrReuseConversation(provider.id, provider.modelId).then(focusComposer);
  }, [createOrReuseConversation, getDefaultProvider]);

  const openSettings = useCallback((tab: SettingsTab = "providers") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleSendMessage = useCallback(() => {
    if (!messageInput.trim() || isStreaming) return;
    void sendMessage(messageInput);
    setMessageInput("");
  }, [isStreaming, messageInput, sendMessage]);

  useShortcuts({
    onShortcutHelp: () => setShortcutHelpOpen(true),
    onNewConversation: handleNewConversation,
    onOpenSettings: () => openSettings(),
    onToggleSidebar: () => setSidebarVisible((visible) => !visible),
    onSendMessage: handleSendMessage,
    onStop: () => {
      if (isStreaming) stopGeneration();
    },
  });

  useEffect(() => {
    void loadProviders();
    void loadConversations();
    void loadUsageRecords();
  }, [loadProviders, loadConversations, loadUsageRecords]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compact = window.matchMedia("(max-width: 820px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setSidebarVisible(!event.matches);
    };
    compact.addEventListener("change", handleViewportChange);
    return () => compact.removeEventListener("change", handleViewportChange);
  }, []);

  return (
    <div className={`app-shell${sidebarVisible ? " sidebar-visible" : ""}`}>
      {sidebarVisible && (
        <Sidebar onOpenSettings={openSettings} onNewConversation={handleNewConversation} />
      )}
      {sidebarVisible && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label={t("sidebar.hide")}
          onClick={() => setSidebarVisible(false)}
        />
      )}
      <div className="main-area">
        <ChatView
          input={messageInput}
          onInputChange={setMessageInput}
          onSendMessage={handleSendMessage}
          onOpenSettings={() => openSettings()}
          onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
          sidebarVisible={sidebarVisible}
        />
      </div>
      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />
      <ShortcutHelpOverlay open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  );
}
