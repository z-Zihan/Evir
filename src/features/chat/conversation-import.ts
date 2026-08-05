import { z } from "zod";
import { db } from "../../core/storage/db";

const attachmentSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  data: z.string(),
  type: z.enum(["image", "text"]).catch("text"),
  createdAt: z.number(),
});

const toolCallSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const toolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  success: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
});

const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  status: z.enum(["complete", "streaming", "error", "stopped"]),
  errorMessage: z.string().optional(),
  createdAt: z.number(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .optional(),
  attachments: z.array(attachmentSchema).optional(),
  toolCalls: z.array(toolCallSchema).optional(),
  toolResults: z.array(toolResultSchema).optional(),
});

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  parentConversationId: z.string().optional(),
  branchedFromMessageId: z.string().optional(),
  messages: z.array(messageSchema),
});

const exportDataSchema = z.object({
  version: z.literal(1),
  exportedAt: z.number(),
  conversations: z.array(conversationSchema),
});

export async function importConversations(
  file: File,
): Promise<{ imported: number; skipped: number }> {
  const text = await file.text();
  const parsed = exportDataSchema.parse(JSON.parse(text));
  let imported = 0;
  let skipped = 0;
  await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
    for (const conv of parsed.conversations) {
      const existing = await db.conversations.get(conv.id);
      if (existing) {
        skipped++;
        continue;
      }
      const { messages, parentConversationId, branchedFromMessageId, ...convRest } = conv;
      await db.conversations.put({
        ...convRest,
        ...(parentConversationId !== undefined ? { parentConversationId } : {}),
        ...(branchedFromMessageId !== undefined ? { branchedFromMessageId } : {}),
      });
      for (const msg of messages) {
        const { attachments, ...msgData } = msg;
        const msgRecord = {
          id: msgData.id,
          conversationId: msgData.conversationId,
          role: msgData.role,
          content: msgData.content,
          status: msgData.status,
          createdAt: msgData.createdAt,
          ...(msgData.errorMessage !== undefined ? { errorMessage: msgData.errorMessage } : {}),
          ...(msgData.usage !== undefined
            ? {
                usage: {
                  ...(msgData.usage.inputTokens !== undefined
                    ? { inputTokens: msgData.usage.inputTokens }
                    : {}),
                  ...(msgData.usage.outputTokens !== undefined
                    ? { outputTokens: msgData.usage.outputTokens }
                    : {}),
                  ...(msgData.usage.totalTokens !== undefined
                    ? { totalTokens: msgData.usage.totalTokens }
                    : {}),
                },
              }
            : {}),
          ...(msgData.toolCalls !== undefined ? { toolCalls: msgData.toolCalls } : {}),
          ...(msgData.toolResults !== undefined
            ? {
                toolResults: msgData.toolResults.map(({ error, ...result }) => ({
                  ...result,
                  ...(error !== undefined ? { error } : {}),
                })),
              }
            : {}),
        };
        await db.messages.put(msgRecord);
        if (attachments) {
          for (const att of attachments) {
            await db.attachments.put(att);
          }
        }
      }
      imported++;
    }
  });
  return { imported, skipped };
}
