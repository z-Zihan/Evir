import { useChatStore } from "../features/chat/chat-store";
import { downloadBlob, exportConversationMarkdown } from "../features/chat/conversation-export";

export async function handleExportMarkdown(conversationId: string): Promise<void> {
  if (!conversationId) return;
  try {
    const blob = await exportConversationMarkdown(conversationId);
    const conv = useChatStore.getState().conversations.find((c) => c.id === conversationId);
    const title = conv?.title || "conversation";
    downloadBlob(blob, `${title}.md`);
  } catch (e) {
    console.error("Failed to export markdown:", e);
  }
}
