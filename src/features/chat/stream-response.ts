import i18n from "../../i18n/config";
import type { StoreApi } from "zustand";
import {
  db,
  type MessageRecord,
  type ProviderRecord,
  type ToolResultRecord,
} from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { formatAttachmentForProvider } from "./attachment-utils";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";
import type { ChatState } from "./chat-store";
import { providerReadinessError, streamAssistant, type StreamResult } from "./chat-stream";
import { useSkillStore } from "../skills/skill-store";
import type { EvirRuntime } from "../../runtime/types";
import type { PendingToolApproval } from "./tool-approval";
import { toMessage, sorted } from "./chat-helpers";
import { createContextBudgetManager } from "../../core/context/context-budget-manager";
import { compactToolOutputs } from "../../core/context/compact-tool-outputs";
import {
  summarizeConversation,
  buildCompressedHistory,
  splitForSummarization,
} from "../../core/context/conversation-summarizer";
import { useMemoryStore } from "../memory/memory-store";
import { createCheckpoint } from "../../core/context/checkpoint";
import { estimateMessagesTokens } from "../../core/context/token-estimate";

const budgetManagerInstance = createContextBudgetManager();

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];
type ProviderMessage = { role: string; content: unknown };

function attachmentMessage(message: MessageRecord, protocolId: string): ProviderMessage {
  if (message.role !== "user" || !message.attachments?.length) {
    return { role: message.role, content: message.content };
  }
  const content: unknown[] = [{ type: "text", text: message.content }];
  for (const attachment of message.attachments) {
    content.push(formatAttachmentForProvider(attachment, protocolId));
  }
  return { role: message.role, content };
}

function resultMessages(results: ToolResultRecord[]): ProviderMessage[] {
  return results.map((result) => ({
    role: "tool",
    content: result.output,
    tool_call_id: result.toolCallId,
    name: result.toolName,
  }));
}

function providerMessage(message: MessageRecord, protocolId: string): ProviderMessage[] {
  if (!message.toolCalls?.length) return [attachmentMessage(message, protocolId)];
  const assistant = {
    role: "assistant",
    content: message.content,
    tool_calls: message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.toolName, arguments: JSON.stringify(call.arguments) },
    })),
  };
  return [assistant, ...resultMessages(message.toolResults ?? [])];
}

function providerMessages(history: MessageRecord[], protocolId: string): ProviderMessage[] {
  return history
    .filter((message) => message.status !== "error")
    .flatMap((message) => providerMessage(message, protocolId));
}

function modeHint(mode: ChatState["mode"]): string {
  if (mode === "agent") return i18n.t("chat.modeHints.agent");
  if (mode === "plan") return i18n.t("chat.modeHints.plan");
  return "";
}

async function getLoopResult(
  provider: ProviderRecord,
  conversationId: string,
  messages: ProviderMessage[],
  set: ChatStoreSet,
  mode: ChatState["mode"],
  runtime: EvirRuntime,
): Promise<AgentLoopResult> {
  const onDelta = (streamingContent: string) => set({ streamingContent });
  if (mode === "agent") {
    return runAgentLoop({
      provider,
      conversationId,
      messages,
      runtime,
      onDelta,
    });
  }
  const stream = await streamAssistant(provider, conversationId, messages, onDelta);
  return { turns: [{ stream }], maxIterationsReached: false, messages: [] };
}

function titleFor(history: MessageRecord[], hasTitle: boolean): string | undefined {
  const firstMessage = history.length === 1 ? history[0] : undefined;
  return !hasTitle && firstMessage?.role === "user" ? firstMessage.content.slice(0, 60) : undefined;
}

async function persistResponse(
  messages: MessageRecord[],
  conversationId: string,
  title?: string,
): Promise<number> {
  const updatedAt = Date.now();
  await db.transaction("rw", db.messages, db.conversations, async () => {
    await db.messages.bulkAdd(messages);
    await db.conversations.update(conversationId, {
      updatedAt,
      ...(title ? { title } : {}),
    });
  });
  return updatedAt;
}

export async function streamResponse(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
  runtime: EvirRuntime,
): Promise<void> {
  const provider = useProviderStore.getState().getDefaultProvider();
  if (!provider) return set({ error: "chat.noProvider" });
  const readinessError = providerReadinessError(provider);
  if (readinessError) return set({ error: readinessError });

  set({ isStreaming: true, streamingContent: "", error: null });
  const mode = get().mode;

  // Context budget: estimate tokens and compact tool outputs if needed
  // TODO: lookup maxContextTokens from ModelProfile.capabilities when available
  const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
  const budgetManager = budgetManagerInstance;
  const inputTokens = estimateMessagesTokens(history);
  const snapshot = budgetManager.snapshot(
    provider.modelId,
    DEFAULT_MAX_CONTEXT_TOKENS,
    inputTokens,
  );

  let effectiveHistory = history;
  if (budgetManager.shouldCompact(snapshot)) {
    const maxToolChars = snapshot.reservedToolTokens * 4;
    effectiveHistory = compactToolOutputs(history, maxToolChars);

    // LLM-based conversation summary when utilization > 75%
    if (
      (snapshot.compressionStage === "conversation-summary" ||
        snapshot.compressionStage === "checkpoint-compaction") &&
      effectiveHistory.length > 6
    ) {
      const targetBudget = Math.floor(DEFAULT_MAX_CONTEXT_TOKENS * 0.4);
      const { toSummarize, toKeep } = splitForSummarization(effectiveHistory, targetBudget);
      if (toSummarize.length >= 3) {
        try {
          console.debug("[evir] context-summary", `summarizing ${toSummarize.length} messages`);
          const summary = await summarizeConversation(provider, toSummarize);
          effectiveHistory = buildCompressedHistory(summary, toKeep, conversationId);
          console.debug(
            "[evir] context-summary",
            `compressed to ${effectiveHistory.length} messages`,
          );
        } catch (error) {
          console.error("[evir] context-summary failed:", error);
        }
      }
    }

    // Create checkpoint when utilization > 90%
    if (snapshot.compressionStage === "checkpoint-compaction") {
      try {
        const objective =
          history.find((m) => m.role === "user")?.content.slice(0, 200) ?? "Unknown objective";
        await createCheckpoint(conversationId, effectiveHistory, objective);
        console.debug("[evir] checkpoint created");
      } catch (error) {
        console.error("[evir] checkpoint failed:", error);
      }
    }

    console.debug(
      "[evir] context-budget",
      `stage=${snapshot.compressionStage}`,
      `utilization=${(snapshot.utilizationRatio * 100).toFixed(1)}%`,
      `inputTokens=${inputTokens}`,
    );
  }

  const messages = providerMessages(effectiveHistory, provider.protocolId);

  const systemParts: string[] = [];
  const hint = modeHint(mode);
  if (hint) systemParts.push(hint);
  if (mode === "agent" || mode === "plan") {
    const skillContent = await useSkillStore.getState().getEnabledContent();
    if (skillContent) {
      systemParts.push(`<active_skills>\n${skillContent}\n</active_skills>`);
    }
  }
  // Inject memory context if available (skip in private sessions)
  const memoryContext = get().privateSession
    ? ""
    : useMemoryStore.getState().buildMemoryContext(conversationId);
  if (memoryContext) {
    systemParts.push(`<memory>\n${memoryContext}\n</memory>`);
  }

  if (systemParts.length > 0) {
    messages.unshift({ role: "system", content: systemParts.join("\n\n") });
  }

  const result = await getLoopResult(provider, conversationId, messages, set, mode, runtime);
  if (result.turns.length === 0) {
    set({ isStreaming: false, streamingContent: "", error: "chat.streamEnded" });
    return;
  }

  const lastTurn = result.turns[result.turns.length - 1];
  const blocked = lastTurn?.pendingApproval;

  if (blocked && mode === "agent") {
    const earlierTurns = result.turns.slice(0, -1);
    const earlierMessages = earlierTurns.map((turn) => toMessage(turn, conversationId));
    if (earlierMessages.length > 0) {
      const conversation = get().conversations.find(({ id }) => id === conversationId);
      const title = titleFor(history, Boolean(conversation?.title));
      await persistResponse(earlierMessages, conversationId, title);
    }

    const blockedMessage = toMessage(lastTurn, conversationId);
    const pendingApproval: PendingToolApproval = {
      toolCallId: blocked.toolCallId,
      toolName: blocked.toolName,
      args: blocked.args,
      conversationId,
      messages: result.messages,
      providerId: provider.id,
      turn: lastTurn,
    };

    set(({ conversations, currentConversationId, messages: currentMessages }) => ({
      conversations: sorted(
        conversations.map((item) =>
          item.id === conversationId ? { ...item, updatedAt: Date.now() } : item,
        ),
      ),
      ...(currentConversationId === conversationId
        ? { messages: [...currentMessages, ...earlierMessages, blockedMessage] }
        : {}),
      isStreaming: false,
      streamingContent: "",
      pendingToolApproval: pendingApproval,
    }));
    return;
  }

  const assistants = result.turns.map((turn) => toMessage(turn, conversationId));
  const conversation = get().conversations.find(({ id }) => id === conversationId);
  const title = titleFor(history, Boolean(conversation?.title));
  const updatedAt = await persistResponse(assistants, conversationId, title);
  const lastStream: StreamResult | undefined = result.turns.at(-1)?.stream;
  const error = result.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;

  set(({ conversations, currentConversationId, messages: currentMessages }) => ({
    conversations: sorted(
      conversations.map((item) =>
        item.id === conversationId ? { ...item, updatedAt, ...(title ? { title } : {}) } : item,
      ),
    ),
    ...(currentConversationId === conversationId
      ? { messages: [...currentMessages, ...assistants] }
      : {}),
    isStreaming: false,
    streamingContent: "",
    error: error ?? null,
  }));
}
