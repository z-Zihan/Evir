import i18n from "../../i18n/config";
import type { StoreApi } from "zustand";
import type {
  AttachmentRecord,
  ConversationRecord,
  MessageRecord,
  ProviderRecord,
  ToolResultRecord,
} from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { formatAttachmentForProvider } from "./attachment-utils";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";
import type { ChatState } from "./chat-store";
import { providerReadinessError, streamAssistant, type StreamResult } from "./chat-stream";
import { useSkillStore } from "../skills/skill-store";
import { routeSkill } from "../../core/skills/skill-router";
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
import { retrieveMemoryContext } from "../../core/memory/memory-retrieval";
import { createCheckpoint } from "../../core/context/checkpoint";
import { estimateMessagesTokens, estimateTokens } from "../../core/context/token-estimate";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { buildAgentRunRecord, persistAgentRun, type AgentRunRecord } from "./agent-run-record";
import { buildRunCapsule, serializeCapsule } from "../../core/context/run-capsule";
import { contextBuilder } from "../../core/context/context-builder";
import type { FileContextReference } from "../../core/context/types";
import { logger } from "../../core/logging/logger";
import {
  buildPersonalizationPrompt,
  loadPersonalizationPreferences,
} from "../settings/personalization-settings";

const budgetManagerInstance = createContextBudgetManager();
const MAX_SUMMARIZATION_ROUNDS = 2;
const INITIAL_SUMMARY_KEEP_RATIO = 0.4;

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
  return {
    turns: [{ stream }],
    maxIterationsReached: false,
    messages: [],
    agentRun: { id: crypto.randomUUID(), snapshots: [], fileReferences: [] },
  };
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
  const storage = getStructuredStorage();
  const conversation = await storage.read<ConversationRecord>("conversations", conversationId);
  await storage.apply([
    ...messages.map((message) => ({
      type: "write" as const,
      entity: "messages" as const,
      id: message.id,
      data: message,
    })),
    ...(conversation
      ? [
          {
            type: "write" as const,
            entity: "conversations" as const,
            id: conversationId,
            data: { ...conversation, updatedAt, ...(title ? { title } : {}) },
          },
        ]
      : []),
  ]);
  return updatedAt;
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

async function latestFileReferences(
  conversationId: string,
  privateRun: AgentRunRecord | null,
): Promise<FileContextReference[]> {
  if (privateRun?.conversationId === conversationId) return privateRun.fileReferences;
  const runs = await getStructuredStorage().readAll<AgentRunRecord>("agent_runs");
  return (
    runs
      .filter((run) => run.conversationId === conversationId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.fileReferences ?? []
  );
}

async function summarizeAndPersist(
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

    try {
      console.debug(
        "[evir] context-summary",
        `round ${round + 1}: summarizing ${toSummarize.length} messages`,
      );
      const sourceMessages = await expandSummarySources(toSummarize);
      const summary = await summarizeConversation(provider, sourceMessages);
      const compressed = buildCompressedHistory(summary, toKeep, conversationId, sourceMessages);
      await persistSummarization(toSummarize, sourceMessages, compressed[0]!);
      current = compressed;
      console.debug(
        "[evir] context-summary",
        `round ${round + 1}: compressed to ${current.length} messages`,
      );
    } catch (error) {
      console.error("[evir] context-summary failed:", error);
      break;
    }

    // Token estimates ignore toolCalls/toolResults content, so rather than re-checking
    // the budget snapshot here, let the next iteration's own toSummarize.length guard
    // decide whether further compression is warranted.
    keepRatio = keepRatio / 2;
  }

  return current;
}

export async function streamResponse(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
  runtime: EvirRuntime,
  explicitlySelectedSkillIds: ReadonlySet<string> = new Set<string>(),
): Promise<void> {
  const provider = useProviderStore.getState().getDefaultProvider();
  if (!provider) return set({ error: "chat.noProvider" });
  const readinessError = providerReadinessError(provider);
  if (readinessError) return set({ error: readinessError });

  set({ isStreaming: true, streamingContent: "", error: null });
  // Web never exposes local execution modes. Enforce that boundary in the
  // application layer as well as the UI so a stale/default Agent state cannot
  // leave browser users in an unavailable mode with no way to switch back.
  const mode = runtime.target === "web" ? "ask" : get().mode;
  if (mode === "agent" && provider.modelCapabilities?.toolCalling !== true) {
    set({ isStreaming: false, streamingContent: "", error: "chat.agentRequiresToolCalling" });
    return;
  }

  // Context budget: estimate tokens and compact tool outputs if needed
  const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
  const maxContextTokens =
    provider.modelCapabilities?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const budgetManager = budgetManagerInstance;
  const inputTokens = estimateMessagesTokens(history);
  const snapshot = budgetManager.snapshot(provider.modelId, maxContextTokens, inputTokens);

  let effectiveHistory = history;
  if (budgetManager.shouldCompact(snapshot)) {
    const maxToolChars = snapshot.reservedToolTokens * 4;
    effectiveHistory = compactToolOutputs(history, maxToolChars);

    // LLM-based conversation summary when utilization > 75%; persisted to DB so the
    // next request doesn't re-load the un-summarized messages and lose the compaction.
    if (
      (snapshot.compressionStage === "conversation-summary" ||
        snapshot.compressionStage === "checkpoint-compaction") &&
      effectiveHistory.length > 6
    ) {
      effectiveHistory = get().privateSession
        ? effectiveHistory
        : await summarizeAndPersist(provider, conversationId, effectiveHistory, maxContextTokens);
      if (get().currentConversationId === conversationId) {
        set({ messages: effectiveHistory });
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

  const hint = modeHint(mode);
  let activeSkills = "";
  let skillRouting = "";
  const skillStore = useSkillStore.getState();
  const compatibleExplicitSkillIds = new Set(
    [...explicitlySelectedSkillIds].filter((id) => {
      const skill = skillStore.skills.find((candidate) => candidate.manifest.id === id);
      return skill && (mode !== "ask" || skill.manifest.capabilities.length === 0);
    }),
  );
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user");
  const routeResult = lastUserMessage
    ? routeSkill(lastUserMessage.content, skillStore.skills, skillStore.enabledSkillIds)
    : { matchedSkills: [], matchReasons: new Map<string, string[]>() };
  const compatibleRoutedSkills = routeResult.matchedSkills.filter(
    (skill) => mode !== "ask" || skill.manifest.capabilities.length === 0,
  );
  const activeSkillIds = new Set([
    ...compatibleExplicitSkillIds,
    ...compatibleRoutedSkills.map((skill) => skill.manifest.id),
  ]);
  if (activeSkillIds.size > 0) {
    activeSkills = await skillStore.getSkillContent(activeSkillIds);
    const availableInputTokens =
      snapshot.maxContextTokens -
      snapshot.reservedOutputTokens -
      snapshot.reservedToolTokens -
      snapshot.safetyMarginTokens;
    const remainingInputTokens = Math.max(
      0,
      availableInputTokens - estimateMessagesTokens(effectiveHistory),
    );
    const skillTokenBudget = Math.floor(remainingInputTokens * 0.4);
    if (estimateTokens(activeSkills) > skillTokenBudget) {
      set({ isStreaming: false, streamingContent: "", error: "chat.skillContextTooLarge" });
      return;
    }
    const routeInfo = compatibleRoutedSkills.map((skill) => {
      const reasons = routeResult.matchReasons.get(skill.manifest.id) ?? [];
      return `- ${skill.manifest.name}: ${reasons.join(", ")}`;
    });
    const explicitInfo = skillStore.skills
      .filter((skill) => compatibleExplicitSkillIds.has(skill.manifest.id))
      .map((skill) => `- ${skill.manifest.name}: explicitly selected by user`);
    const routingLines = [...explicitInfo, ...routeInfo];
    if (routingLines.length > 0) {
      skillRouting = `Active skills:\n${routingLines.join("\n")}`;
    }
  }
  // Resolve memory from storage for every request so startup and settings-page state
  // cannot affect whether global/workspace/conversation memories reach the model.
  let memoryContext = "";
  let relevantMemoryIds: string[] = [];
  if (!get().privateSession) {
    const availableInputTokens =
      snapshot.maxContextTokens -
      snapshot.reservedOutputTokens -
      snapshot.reservedToolTokens -
      snapshot.safetyMarginTokens;
    const remainingAfterHistoryAndSkills = Math.max(
      0,
      availableInputTokens -
        estimateMessagesTokens(effectiveHistory) -
        estimateTokens(activeSkills) -
        estimateTokens(skillRouting),
    );
    try {
      const retrieval = await retrieveMemoryContext(getStructuredStorage(), {
        conversationId,
        workspacePath: runtime.getWorkspaceRoot?.() ?? null,
        query: lastUserMessage?.content ?? "",
        maxCharacters: Math.min(6_000, Math.floor(remainingAfterHistoryAndSkills * 0.15) * 4),
      });
      memoryContext = retrieval.context;
      relevantMemoryIds = retrieval.memoryIds;
    } catch (error) {
      logger.warn("memory", "memory.context-load-failed", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (snapshot.compressionStage === "checkpoint-compaction" && !get().privateSession) {
    try {
      const objective =
        history.find((message) => message.role === "user")?.content.slice(0, 200) ??
        "Unknown objective";
      await createCheckpoint(conversationId, effectiveHistory, objective, {
        mode,
        relevantMemoryIds,
      });
      logger.debug("context", "checkpoint.created", { conversationId });
    } catch (error) {
      logger.error("context", "checkpoint.create-failed", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const fileReferences = await latestFileReferences(conversationId, get().latestAgentRun);
  const personalization = get().privateSession
    ? ""
    : buildPersonalizationPrompt(await loadPersonalizationPreferences());
  const { systemPrompt } = contextBuilder.buildSystemPrompt({
    modeRules: hint,
    ...(mode === "agent" || mode === "plan"
      ? { runCapsule: serializeCapsule(buildRunCapsule(effectiveHistory)) }
      : {}),
    activeSkills,
    skillRouting,
    memory: memoryContext,
    fileReferences,
    personalization,
  });
  if (systemPrompt) messages.unshift({ role: "system", content: systemPrompt });

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
      if (!get().privateSession) await persistResponse(earlierMessages, conversationId, title);
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
      agentRun: result.agentRun,
    };
    const agentRunRecord = buildAgentRunRecord(result, conversationId);
    if (!get().privateSession) await persistAgentRun(agentRunRecord);

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
      latestAgentRun: agentRunRecord,
    }));
    return;
  }

  const assistants = result.turns.map((turn) => toMessage(turn, conversationId));
  const conversation = get().conversations.find(({ id }) => id === conversationId);
  const title = titleFor(history, Boolean(conversation?.title));
  const updatedAt = get().privateSession
    ? Date.now()
    : await persistResponse(assistants, conversationId, title);
  const lastStream: StreamResult | undefined = result.turns.at(-1)?.stream;
  const error = result.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;
  const agentRunRecord = mode === "agent" ? buildAgentRunRecord(result, conversationId) : null;
  if (agentRunRecord && !get().privateSession) await persistAgentRun(agentRunRecord);

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
    latestAgentRun: agentRunRecord,
  }));
}
