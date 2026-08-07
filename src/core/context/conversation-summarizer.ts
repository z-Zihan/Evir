import type { MessageRecord, ProviderRecord } from "../storage/db";
import { streamAssistant, type StreamResult } from "../../features/chat/chat-stream";
import { estimateMessagesTokens } from "./token-estimate";

/**
 * Summarize old conversation messages using the current provider.
 * Returns a compact summary that preserves key information.
 */
export async function summarizeConversation(
  provider: ProviderRecord,
  messages: MessageRecord[],
  options?: { maxSummaryTokens?: number },
): Promise<string> {
  const maxTokens = options?.maxSummaryTokens ?? 500;

  if (messages.length === 0) return "";

  // Build messages for summarization
  const conversationText = messages
    .map((m) => {
      const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
      let text = `${role}: ${m.content}`;
      if (m.toolCalls?.length) {
        text += ` [called tools: ${m.toolCalls.map((tc) => tc.toolName).join(", ")}]`;
      }
      if (m.toolResults?.length) {
        const results = m.toolResults.map((r) => `${r.toolName}: ${r.success ? "ok" : "failed"}`);
        text += ` [results: ${results.join("; ")}]`;
      }
      return text;
    })
    .join("\n");

  const summaryPrompt: { role: string; content: unknown }[] = [
    {
      role: "system",
      content: `You are a conversation summarizer. Summarize the following conversation in under ${maxTokens} tokens. Preserve:
1. User's original goal and constraints
2. Key decisions made
3. Files read or modified (with paths)
4. Commands executed and their results
5. Any errors encountered
6. Current progress status
7. Pending tasks or next steps

Output a concise summary. Do not include pleasantries.`,
    },
    {
      role: "user",
      content: conversationText,
    },
  ];

  const result: StreamResult = await streamAssistant(provider, "summary", summaryPrompt, () => {});

  return result.content || "Summary unavailable";
}

/**
 * Build a compressed message history:
 * - Recent messages (last N) kept in full
 * - Older messages replaced by a summary
 */
export function buildCompressedHistory(
  summary: string,
  recentMessages: MessageRecord[],
  conversationId: string,
  sourceMessages: MessageRecord[] = [],
): MessageRecord[] {
  const id = `summary-${crypto.randomUUID()}`;
  const archiveId = `summary-source:${id}`;
  const summaryMessage: MessageRecord = {
    id,
    conversationId,
    role: "system",
    content: `[Previous conversation summary]\n${summary}`,
    status: "complete",
    createdAt: recentMessages[0]?.createdAt ?? Date.now(),
    ...(sourceMessages.length > 0
      ? {
          summaryMetadata: {
            version: 1 as const,
            sourceMessageIds: sourceMessages.map(({ id: sourceId }) => sourceId),
            sourceStartedAt: sourceMessages[0]?.createdAt ?? Date.now(),
            sourceEndedAt: sourceMessages.at(-1)?.createdAt ?? Date.now(),
            archiveId,
          },
        }
      : {}),
  };

  return [summaryMessage, ...recentMessages];
}

/**
 * Estimate how many tokens a summary would save.
 */
export function estimateSavings(originalMessages: MessageRecord[], summaryTokens: number): number {
  const originalTokens = estimateMessagesTokens(originalMessages);
  return Math.max(0, originalTokens - summaryTokens);
}

/**
 * Split messages into "to summarize" and "to keep" based on token budget.
 * Keeps the most recent messages that fit within the budget.
 */
export function splitForSummarization(
  messages: MessageRecord[],
  targetTokenBudget: number,
): { toSummarize: MessageRecord[]; toKeep: MessageRecord[] } {
  const reversed = [...messages].reverse();
  let keptTokens = 0;
  let keepCount = 0;

  for (const msg of reversed) {
    const msgTokens = estimateMessagesTokens([msg]);
    if (keptTokens + msgTokens > targetTokenBudget && keepCount > 0) break;
    keptTokens += msgTokens;
    keepCount += 1;
  }

  const toKeep = reversed.slice(0, keepCount).reverse();
  const toSummarize = messages.slice(0, messages.length - keepCount);

  return { toSummarize, toKeep };
}
