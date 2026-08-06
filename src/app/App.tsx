import { useCallback, useEffect, useRef, useState } from "react";
import { useProviderStore } from "../features/provider/provider-store";
import { useChatStore } from "../features/chat/chat-store";
import { useUsageStore } from "../features/usage/usage-store";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { SettingsModal } from "./SettingsModal";
import { useShortcuts } from "./useShortcuts";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { WorkspaceSelector } from "./WorkspaceSelector";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [messageInput, setMessageInput] = useState("");
  const focusSearchRef = useRef<(() => void) | null>(null);
  const { loadProviders, getDefaultProvider } = useProviderStore();
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
    onShortcutHelp: () => setShortcutHelpOpen(true),
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

  return (
    <div className="app-shell">
      {sidebarVisible && (
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} focusSearchRef={focusSearchRef} />
      )}
      <WorkspaceSelector />
      <ChatView
        input={messageInput}
        onInputChange={setMessageInput}
        onSendMessage={handleSendMessage}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ShortcutHelpOverlay open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  );
}
