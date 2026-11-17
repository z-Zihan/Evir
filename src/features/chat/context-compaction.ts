import type { AttachmentRecord, MessageRecord, ProviderRecord } from "../../core/storage/db";
import { streamAssistant } from "./chat-stream";
import { getStructuredStorage } from "../../runtime/structured-storage";
import {
  summarizeConversation,
  buildCompressedHistory,
  splitForSummarization,
} from "../../core/context/conversation-summarizer";
import { estimateMessagesTokens } from "../../core/context/token-estimate";
import { logger } from "../../core/logging/logger";

/**
 * Conversation compaction (context summarization) extracted from
 * stream-response.ts: multi-round summarization with durable archive
 * artifacts, so long conversations keep their user constraints while the
 * prompt stays inside the model budget.
 */

const MAX_SUMMARIZATION_ROUNDS = 2;
const INITIAL_SUMMARY_KEEP_RATIO = 0.4;

type SummaryArchive = { messages?: MessageRecord[]; attachments?: AttachmentRecord[] };

/**
 * Archives of prior summaries absorbed into this round. They are only
 * superseded when the new archive re-expanded every one of their messages and
 * no other conversation (branches copy summaries verbatim) still references
 * them; anything uncertain keeps the archive.
 */
async function findSupersededArchives(
  toSummarize: MessageRecord[],
  sourceMessages: MessageRecord[],
  conversationId: string,
): Promise<Array<{ id: string; archive: SummaryArchive }>> {
  const absorbedIds = [
    ...new Set(toSummarize.flatMap(({ summaryMetadata }) => summaryMetadata?.archiveId ?? [])),
  ];
  if (absorbedIds.length === 0) return [];
  const storage = getStructuredStorage();
  const sourceIds = new Set(sourceMessages.map(({ id }) => id));
  const archives = (
    await Promise.all(
      absorbedIds.map(async (id) => ({
        id,
        archive: await storage.read<SummaryArchive>("artifacts", id),
      })),
    )
  ).flatMap(({ id, archive }) =>
    archive?.messages?.length && archive.messages.every((message) => sourceIds.has(message.id))
      ? [{ id, archive }]
      : [],
  );
  const referencedElsewhere = new Set(
    archives.length
      ? (await storage.readAll<MessageRecord>("messages")).flatMap((message) =>
          message.conversationId !== conversationId && message.summaryMetadata
            ? [message.summaryMetadata.archiveId]
            : [],
        )
      : [],
  );
  return archives.filter(({ id }) => !referencedElsewhere.has(id));
}

async function persistSummarization(
  toSummarize: MessageRecord[],
  sourceMessages: MessageRecord[],
  summaryMessage: MessageRecord,
): Promise<void> {
  const idsToDelete = toSummarize.map((message) => message.id);
  const storage = getStructuredStorage();
  const attachments = await storage.readAll<AttachmentRecord>("attachments");
  const messageIds = new Set(idsToDelete);
  const summarizedAttachments = attachments.filter(({ messageId }) => messageIds.has(messageId));
  const archiveId = summaryMessage.summaryMetadata?.archiveId;
  const supersededArchives = archiveId
    ? await findSupersededArchives(toSummarize, sourceMessages, summaryMessage.conversationId)
    : [];
  // Attachments archived by a superseded round only live in its artifact, so
  // they move into the new archive before that artifact is deleted.
  const archivedAttachments = [
    ...supersededArchives.flatMap(({ archive }) => archive.attachments ?? []),
    ...summarizedAttachments,
  ];
  await storage.apply([
    ...(archiveId
      ? [
          {
            type: "write" as const,
            entity: "artifacts" as const,
            id: archiveId,
            data: {
              id: archiveId,
              type: "conversation-summary-source",
              relatedEntityId: summaryMessage.conversationId,
              messages: sourceMessages,
              attachments: archivedAttachments,
              createdAt: Date.now(),
            },
          },
        ]
      : []),
    ...summarizedAttachments.map(({ id }) => ({
      type: "delete" as const,
      entity: "attachments" as const,
      id,
    })),
    ...idsToDelete.map((id) => ({ type: "delete" as const, entity: "messages" as const, id })),
    { type: "write", entity: "messages", id: summaryMessage.id, data: summaryMessage },
    ...supersededArchives.map(({ id }) => ({
      type: "delete" as const,
      entity: "artifacts" as const,
      id,
    })),
  ]);
}

async function expandSummarySources(messages: MessageRecord[]): Promise<MessageRecord[]> {
  const expanded: MessageRecord[] = [];
  for (const message of messages) {
    const archiveId = message.summaryMetadata?.archiveId;
    if (!archiveId) {
      expanded.push(message);
      continue;
    }
    const archive = await getStructuredStorage().read<{ messages?: MessageRecord[] }>(
      "artifacts",
      archiveId,
    );
    expanded.push(...(archive?.messages?.length ? archive.messages : [message]));
  }
  return expanded;
}

export async function summarizeAndPersist(
  provider: ProviderRecord,
  conversationId: string,
  history: MessageRecord[],
  maxContextTokens: number,
): Promise<MessageRecord[]> {
  let current = history;
  let keepRatio = INITIAL_SUMMARY_KEEP_RATIO;

  for (let round = 0; round < MAX_SUMMARIZATION_ROUNDS; round++) {
    if (current.length <= 6) break;
    const targetBudget = Math.floor(maxContextTokens * keepRatio);
    const { toSummarize, toKeep } = splitForSummarization(current, targetBudget);
    if (toSummarize.length < 3) break;

    const roundStartedAt = Date.now();
    const beforeMessageCount = current.length;
    const beforeEstimatedTokens = estimateMessagesTokens(current);
    try {
      logger.debug("context", "context.summary-started", {
        conversationId,
        round: round + 1,
        messageCount: toSummarize.length,
      });
      const sourceMessages = await expandSummarySources(toSummarize);
      const summary = await summarizeConversation(provider, sourceMessages, {
        streamFn: streamAssistant,
      });
      const compressed = buildCompressedHistory(summary, toKeep, conversationId, sourceMessages);
      await persistSummarization(toSummarize, sourceMessages, compressed[0]!);
      current = compressed;
      logger.debug("context", "context.summary-completed", {
        conversationId,
        round: round + 1,
        beforeMessageCount,
        afterMessageCount: current.length,
        beforeEstimatedTokens,
        afterEstimatedTokens: estimateMessagesTokens(current),
        summarizedMessageCount: toSummarize.length,
        durationMs: Date.now() - roundStartedAt,
      });
    } catch (error) {
      logger.error("context", "context.summary-failed", {
        conversationId,
        round: round + 1,
        errorType: error instanceof Error ? error.name : "unknown",
        durationMs: Date.now() - roundStartedAt,
      });
      break;
    }

    // Token estimates ignore toolCalls/toolResults content, so rather than re-checking
    // the budget snapshot here, let the next iteration's own toSummarize.length guard
    // decide whether further compression is warranted.
    keepRatio = keepRatio / 2;
  }

  return current;
}
