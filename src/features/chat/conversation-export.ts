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
  return text.replace(/\\([*_`[\]()#])/g, "$1");
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
  const conv = await db.conversations.get(id);
  if (!conv) throw new Error("Conversation not found");
  const messages = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
  const messagesWithAttachments = await Promise.all(
    messages.map(async (msg) => {
      const attachments = await db.attachments.where("messageId").equals(msg.id).toArray();
      return { ...msg, attachments };
    }),
  );
  const md = exportConversationAsMarkdown(conv, messagesWithAttachments);
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
