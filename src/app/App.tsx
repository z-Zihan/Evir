import { useCallback, useEffect, useRef, useState } from "react";
import { useProviderStore } from "../features/provider/provider-store";
import { useChatStore } from "../features/chat/chat-store";
import { useUsageStore } from "../features/usage/usage-store";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { SettingsModal } from "./SettingsModal";
import { useShortcuts } from "./useShortcuts";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [messageInput, setMessageInput] = useState("");
  const focusSearchRef = useRef<(() => void) | null>(null);
  const { providers, loadProviders, getDefaultProvider } = useProviderStore();
  const { loadConversations, createConversation, sendMessage, stopGeneration, isStreaming } =
    useChatStore();
  const loadUsageRecords = useUsageStore((state) => state.loadRecords);

  const handleNewConversation = useCallback(() => {
    const provider = getDefaultProvider();
    if (provider) void createConversation(provider.id, provider.modelId);
    else setSettingsOpen(true);
  }, [createConversation, getDefaultProvider]);

  const handleSendMessage = useCallback(() => {
    if (!messageInput.trim() || isStreaming) return;
    void sendMessage(messageInput);
    setMessageInput("");
  }, [isStreaming, messageInput, sendMessage]);

  useShortcuts({
    onNewConversation: handleNewConversation,
    onOpenSettings: () => setSettingsOpen(true),
    onToggleSidebar: () => setSidebarVisible((visible) => !visible),
    onSearchConversations: () => {
      if (!sidebarVisible) setSidebarVisible(true);
      // Use rAF to wait for sidebar to mount if it was hidden
      requestAnimationFrame(() => focusSearchRef.current?.());
    },
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
    if (providers.length === 0) setSettingsOpen(true);
  }, [providers.length]);

  return (
    <div className="app-shell">
      {sidebarVisible && (
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} focusSearchRef={focusSearchRef} />
      )}
      <ChatView
        input={messageInput}
        onInputChange={setMessageInput}
        onSendMessage={handleSendMessage}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
