import { useEffect, useState } from "react";
import { useProviderStore } from "../features/provider/provider-store";
import { useChatStore } from "../features/chat/chat-store";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { SettingsModal } from "./SettingsModal";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { providers, loadProviders } = useProviderStore();
  const { loadConversations } = useChatStore();

  useEffect(() => {
    void loadProviders();
    void loadConversations();
  }, [loadProviders, loadConversations]);

  useEffect(() => {
    if (providers.length === 0) setSettingsOpen(true);
  }, [providers.length]);

  return (
    <div className="app-shell">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <ChatView onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
