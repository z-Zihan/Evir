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

async function persistSummarization(
  toSummarize: MessageRecord[],
  sourceMessages: MessageRecord[],
  summaryMessage: MessageRecord,
): Promise<void> {
  const idsToDelete = toSummarize.map((message) => message.id);
  const storage = getStructuredStorage();
  const attachments = await storage.readAll<AttachmentRecord>("attachments");
  const messageIds = new Set(idsToDelete);
  const archivedAttachments = attachments.filter(({ messageId }) => messageIds.has(messageId));
  const archiveId = summaryMessage.summaryMetadata?.archiveId;
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
    ...archivedAttachments.map(({ id }) => ({
      type: "delete" as const,
      entity: "attachments" as const,
      id,
    })),
    ...idsToDelete.map((id) => ({ type: "delete" as const, entity: "messages" as const, id })),
    { type: "write", entity: "messages", id: summaryMessage.id, data: summaryMessage },
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
