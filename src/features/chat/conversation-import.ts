import { z } from "zod";
import type { StorageMutation } from "../../core/storage/storage-port";
import { getStructuredStorage } from "../../runtime/structured-storage";

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
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  durationMs: z.number().optional(),
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
  activeSkills: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  toolCalls: z.array(toolCallSchema).optional(),
  toolResults: z.array(toolResultSchema).optional(),
  summaryMetadata: z
    .object({
      version: z.literal(1),
      sourceMessageIds: z.array(z.string()),
      sourceStartedAt: z.number(),
      sourceEndedAt: z.number(),
      archiveId: z.string(),
    })
    .optional(),
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
  // Keep parity with ConversationRecord: without these an export → import
  // round-trip silently drops project ownership and pinning.
  pinned: z.number().optional(),
  projectId: z.string().nullable().optional(),
  messages: z.array(messageSchema),
});

const summaryArchiveSchema = z.object({
  id: z.string(),
  type: z.literal("conversation-summary-source"),
  relatedEntityId: z.string(),
  createdAt: z.number().optional(),
  messages: z.array(messageSchema),
  attachments: z.array(attachmentSchema).optional(),
});

const exportDataSchema = z.object({
  version: z.literal(1),
  exportedAt: z.number(),
  conversations: z.array(conversationSchema),
  // Absent in exports that predate summary-archive export.
  archives: z.array(summaryArchiveSchema).optional(),
});

export async function importConversations(
  file: File,
): Promise<{ imported: number; skipped: number }> {
  const text = await file.text();
  const parsed = exportDataSchema.parse(JSON.parse(text));
  let imported = 0;
  let skipped = 0;
  const storage = getStructuredStorage();
  const mutations: StorageMutation[] = [];
  const archivesById = new Map((parsed.archives ?? []).map((archive) => [archive.id, archive]));
  // Archives already queued or already in storage; local data is never overwritten.
  const handledArchiveIds = new Set<string>();
  for (const conv of parsed.conversations) {
    const existing = await storage.read("conversations", conv.id);
    if (existing) {
      skipped++;
      continue;
    }
    const { messages, parentConversationId, branchedFromMessageId, ...convRest } = conv;
    const conversationRecord = {
      ...convRest,
      ...(parentConversationId !== undefined ? { parentConversationId } : {}),
      ...(branchedFromMessageId !== undefined ? { branchedFromMessageId } : {}),
    };
    mutations.push({
      type: "write",
      entity: "conversations",
      id: conversationRecord.id,
      data: conversationRecord,
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
        ...(msgData.summaryMetadata !== undefined
          ? { summaryMetadata: msgData.summaryMetadata }
          : {}),
        ...(msgData.activeSkills !== undefined ? { activeSkills: msgData.activeSkills } : {}),
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
      mutations.push({ type: "write", entity: "messages", id: msgRecord.id, data: msgRecord });
      const archiveId = msgData.summaryMetadata?.archiveId;
      const archive = archiveId !== undefined ? archivesById.get(archiveId) : undefined;
      if (archive && !handledArchiveIds.has(archive.id)) {
        handledArchiveIds.add(archive.id);
        if (!(await storage.read("artifacts", archive.id))) {
          mutations.push({ type: "write", entity: "artifacts", id: archive.id, data: archive });
        }
      }
      if (attachments) {
        for (const att of attachments) {
          mutations.push({ type: "write", entity: "attachments", id: att.id, data: att });
        }
      }
    }
    imported++;
  }
  await storage.apply(mutations);
  return { imported, skipped };
}
