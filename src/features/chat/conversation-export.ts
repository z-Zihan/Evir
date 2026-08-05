import {
  db,
  type ConversationRecord,
  type MessageRecord,
  type AttachmentRecord,
} from "../../core/storage/db";

interface ExportData {
  // API Key is never included in exports — only conversations, messages, and attachments are exported
  version: 1;
  exportedAt: number;
  conversations: Array<
    ConversationRecord & { messages: Array<MessageRecord & { attachments: AttachmentRecord[] }> }
  >;
}

export async function exportConversations(): Promise<Blob> {
  const conversations = await db.conversations.toArray();
  const result: ExportData = { version: 1, exportedAt: Date.now(), conversations: [] };
  for (const conv of conversations) {
    const messages = await db.messages.where("conversationId").equals(conv.id).sortBy("createdAt");
    const messagesWithAttachments = await Promise.all(
      messages.map(async (msg) => {
        const attachments = await db.attachments.where("messageId").equals(msg.id).toArray();
        return { ...msg, attachments };
      }),
    );
    result.conversations.push({ ...conv, messages: messagesWithAttachments });
  }
  return new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
}

export async function exportConversation(id: string): Promise<Blob> {
  const conv = await db.conversations.get(id);
  if (!conv) throw new Error("Conversation not found");
  const messages = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
  const messagesWithAttachments = await Promise.all(
    messages.map(async (msg) => {
      const attachments = await db.attachments.where("messageId").equals(msg.id).toArray();
      return { ...msg, attachments };
    }),
  );
  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    conversations: [{ ...conv, messages: messagesWithAttachments }],
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
