import type { ConversationRecord, MessageRecord, AttachmentRecord } from "../../core/storage/db";
import { getStructuredStorage } from "../../runtime/structured-storage";

interface ExportData {
  // API Key is never included in exports — only conversations, messages, and attachments are exported
  version: 1;
  exportedAt: number;
  conversations: Array<
    ConversationRecord & { messages: Array<MessageRecord & { attachments: AttachmentRecord[] }> }
  >;
}

export async function exportConversations(): Promise<Blob> {
  const storage = getStructuredStorage();
  const conversations = await storage.readAll<ConversationRecord>("conversations");
  const result: ExportData = { version: 1, exportedAt: Date.now(), conversations: [] };
  for (const conv of conversations) {
    const messages = await storage.query<MessageRecord>("messages", { conversationId: conv.id });
    messages.sort((a, b) => a.createdAt - b.createdAt);
    const messagesWithAttachments = await Promise.all(
      messages.map(async (msg) => {
        const attachments = await storage.query<AttachmentRecord>("attachments", {
          messageId: msg.id,
        });
        return { ...msg, attachments };
      }),
    );
    result.conversations.push({ ...conv, messages: messagesWithAttachments });
  }
  return new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
}

async function getConversationWithMessages(id: string) {
  const storage = getStructuredStorage();
  const conv = await storage.read<ConversationRecord>("conversations", id);
  if (!conv) throw new Error("Conversation not found");
  const messages = await storage.query<MessageRecord>("messages", { conversationId: id });
  messages.sort((a, b) => a.createdAt - b.createdAt);
  const messagesWithAttachments = await Promise.all(
    messages.map(async (msg) => {
      const attachments = await storage.query<AttachmentRecord>("attachments", {
        messageId: msg.id,
      });
      return { ...msg, attachments };
    }),
  );
  return { conv, messages: messagesWithAttachments };
}

export async function exportConversation(id: string): Promise<Blob> {
  const { conv, messages } = await getConversationWithMessages(id);
  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    conversations: [{ ...conv, messages: messages }],
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "tool":
      return "Tool";
    default:
      return role;
  }
}

function escapeMd(text: string): string {
  // Escape inline Markdown special characters
  let escaped = text.replace(/([*_`[\]()#])/g, "\\$1");
  // Escape line-start special characters: > -, *, #, = at beginning of line
  escaped = escaped.replace(/^(>|-{1,2}|\*{1,2}|#{1,6}|=+)/gm, "\\$1");
  return escaped;
}

export function exportConversationAsMarkdown(
  conv: ConversationRecord,
  messages: Array<MessageRecord & { attachments: AttachmentRecord[] }>,
): string {
  const lines: string[] = [];
  lines.push(`# ${conv.title || "Untitled"}`);
  lines.push("");
  lines.push(
    `> Provider: ${conv.providerId} | Model: ${conv.modelId} | Created: ${new Date(conv.createdAt).toISOString()}`,
  );
  lines.push("");
  for (const msg of messages) {
    lines.push(`## ${roleLabel(msg.role)}`);
    lines.push("");
    lines.push(escapeMd(msg.content));
    if (msg.attachments.length > 0) {
      lines.push("");
      lines.push("**Attachments:**");
      for (const att of msg.attachments) {
        lines.push(`- ${att.fileName} (${att.mimeType})`);
      }
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`*Exported from Evir on ${new Date().toISOString()}*`);
  return lines.join("\n");
}

export async function exportConversationMarkdown(id: string): Promise<Blob> {
  const { conv, messages } = await getConversationWithMessages(id);
  const md = exportConversationAsMarkdown(conv, messages);
  return new Blob([md], { type: "text/markdown" });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
