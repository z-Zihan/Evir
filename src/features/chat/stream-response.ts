import i18n from "../../i18n/config";
import type { StoreApi } from "zustand";
import type {
  AttachmentRecord,
  ConversationRecord,
  MessageRecord,
  ProviderRecord,
} from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import { formatAttachmentForProvider } from "./attachment-utils";
import {
  runAgentLoop,
  assistantToolCallWireMessage,
  toolResultWireMessages,
  type AgentLoopResult,
} from "./agent-loop";
import type { ChatState } from "./chat-store";
import {
  createActiveTaskController,
  providerReadinessError,
  streamAssistant,
  type StreamResult,
} from "./chat-stream";
import { useSkillStore } from "../skills/skill-store";
import { routeSkill } from "../../core/skills/skill-router";
import type { EvirRuntime } from "../../runtime/types";
import { toApprovalRecord, type PendingToolApproval } from "./tool-approval";
import { toMessage, sorted } from "./chat-helpers";
import { collectWorkspaceContext } from "../workspace/workspace-context";
import { TOOL_DENIED } from "../../core/tools/tool-executor";
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
import { requiresToolCalling } from "../../core/providers/tool-registry";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "../../core/providers/model-defaults";
import { getStructuredStorage } from "../../runtime/structured-storage";
import {
  buildAgentRunRecord,
  finalizeAutomaticVerification,
  persistAgentRun,
  type AgentRunRecord,
} from "./agent-run-record";
import { buildRunCapsule, serializeCapsule } from "../../core/context/run-capsule";
import { contextBuilder } from "../../core/context/context-builder";
import type { FileContextReference } from "../../core/context/types";
import { logger } from "../../core/logging/logger";
import {
  buildPersonalizationPrompt,
  loadPersonalizationPreferences,
} from "../settings/personalization-settings";
import { runOrchestratedAgent } from "../orchestration/run-orchestrated-agent";
import { effectiveModeForModel } from "../projects/conversation-mode";
import { useOrchestrationStore } from "../orchestration/orchestration-store";
import {
  beginConversationStream,
  finishConversationStream,
  ownsConversationSlot,
  setPendingApproval,
  updateConversationStream,
  visibleForConversation,
} from "./stream-ownership";

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

function providerMessage(message: MessageRecord, protocolId: string): ProviderMessage[] {
  if (!message.toolCalls?.length) return [attachmentMessage(message, protocolId)];
  const assistant = assistantToolCallWireMessage(
    message.content,
    message.toolCalls.map((call) => ({
      id: call.id,
      toolName: call.toolName,
      arguments: JSON.stringify(call.arguments),
    })),
  );
  return [assistant, ...toolResultWireMessages(message.toolResults ?? [])];
}

function providerMessages(history: MessageRecord[], protocolId: string): ProviderMessage[] {
  return history
    .filter((message) => message.status !== "error")
    .flatMap((message) => providerMessage(message, protocolId));
}

function normalizeLatestUserMessage(
  history: MessageRecord[],
  normalizedInput: string,
): MessageRecord[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "user") continue;
    if (message.content === normalizedInput) return history;
    const normalized = [...history];
    normalized[index] = { ...message, content: normalizedInput };
    return normalized;
  }
  return history;
}

function modeHint(mode: ChatState["mode"]): string {
  if (mode === "agent") return i18n.t("chat.modeHints.agent");
  if (mode === "plan") return i18n.t("chat.modeHints.plan");
  if (mode === "goal") return i18n.t("chat.modeHints.goal");
  return "";
}

async function getLoopResult(
  provider: ProviderRecord,
  conversationId: string,
  messages: ProviderMessage[],
  set: ChatStoreSet,
  get: ChatStoreGet,
  mode: ChatState["mode"],
  runtime: EvirRuntime,
  privateSession: boolean,
): Promise<AgentLoopResult> {
  const onDelta = (streamingContent: string) =>
    updateConversationStream(set, get, conversationId, streamingContent);
  if (mode === "agent" || mode === "goal" || mode === "plan") {
    const task = createActiveTaskController(conversationId);
    try {
      const orchestration = useOrchestrationStore.getState().snapshotFor(conversationId);
      if (
        (mode === "agent" || mode === "goal") &&
        orchestration?.conversationId === conversationId &&
        orchestration.phase === "execution"
      ) {
        return await runOrchestratedAgent({
          provider,
          conversationId,
          messages,
          runtime,
          privateSession,
          onDelta,
          signal: task.signal,
        });
      }
      return await runAgentLoop({
        provider,
        conversationId,
        messages,
        runtime,
        onDelta,
        mode,
        signal: task.signal,
      });
    } finally {
      task.dispose();
    }
  }
  // Ask-mode hang protection: generous wall clock so slow models stay usable,
  // but a dead connection surfaces as a timeout instead of spinning forever.
  const ASK_STREAM_TIMEOUT_MS = 300_000;
  const stream = await streamAssistant(
    provider,
    conversationId,
    messages,
    onDelta,
    undefined,
    undefined,
    ASK_STREAM_TIMEOUT_MS,
  );
  return {
    turns: [{ stream: explainToolCallWithoutAccess(stream) }],
    maxIterationsReached: false,
    messages: [],
    agentRun: { id: crypto.randomUUID(), snapshots: [], fileReferences: [] },
  };
}

/**
 * Ask 模式没有工具：模型仍返回 tool_calls 时内容为空，给出可理解的解释而不是空白回复。
 */
export function explainToolCallWithoutAccess(stream: StreamResult): StreamResult {
  const unusableToolCalls = stream.toolCalls ?? [];
  if (unusableToolCalls.length === 0 || stream.content.trim()) return stream;
  const toolNames = [...new Set(unusableToolCalls.map(({ toolName }) => toolName))].join(", ");
  return { ...stream, content: i18n.t("chat.toolCallWithoutToolAccess", { toolNames }) };
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

  const streamStartedAt = beginConversationStream(set, get, conversationId);
  try {
    await runStreamResponse(
      set,
      get,
      history,
      conversationId,
      runtime,
      provider,
      explicitlySelectedSkillIds,
      streamStartedAt,
    );
  } catch (error) {
    // A persistence/harness failure must not leave the composer wedged in the
    // streaming state; raw message text follows the lastStream?.errorMessage
    // precedent (i18next renders unknown keys verbatim).
    if (visibleForConversation(get, conversationId)) {
      set({ error: error instanceof Error ? error.message : "chat.streamFailed" });
    }
  } finally {
    finishConversationStream(set, get, conversationId, streamStartedAt);
  }
}

async function runStreamResponse(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
  runtime: EvirRuntime,
  provider: ProviderRecord,
  explicitlySelectedSkillIds: ReadonlySet<string>,
  streamStartedAt: number,
): Promise<void> {
  const lastUserMessage = [...history].reverse().find((message) => message.role === "user");
  const requestedMode = get().mode;
  const conversation = get().conversations.find(({ id }) => id === conversationId);
  // Project modes (agent/plan/goal) only run inside a project thread; legacy
  // global-workspace behavior covers standalone conversations until the first
  // project exists.
  let mode =
    runtime.target === "web"
      ? "ask"
      : effectiveModeForModel(
          conversation,
          requestedMode,
          provider.modelCapabilities?.toolCalling === true,
        );
  let normalizedUserInput = lastUserMessage?.content ?? "";
  if (runtime.harnessMiddlewareRegistry) {
    const request = await runtime.harnessMiddlewareRegistry.dispatch({
      type: "request",
      conversationId,
      target: runtime.target,
      requestedMode,
      effectiveMode: mode,
      providerToolCalling: provider.modelCapabilities?.toolCalling === true,
      userInput: lastUserMessage?.content ?? "",
      normalizedInput: lastUserMessage?.content ?? "",
      blocked: false,
    });
    mode = request.effectiveMode;
    normalizedUserInput = request.normalizedInput;
    if (request.blocked) {
      if (visibleForConversation(get, conversationId)) {
        set({
          error:
            request.blockReason === "agent-requires-tool-calling"
              ? "chat.agentRequiresToolCalling"
              : (request.blockReason ?? "chat.streamEnded"),
        });
      }
      return;
    }
  }
  if (requiresToolCalling(mode) && provider.modelCapabilities?.toolCalling !== true) {
    if (visibleForConversation(get, conversationId)) {
      set({ error: "chat.agentRequiresToolCalling" });
    }
    return;
  }

  // Context budget: estimate tokens and compact tool outputs if needed
  const maxContextTokens =
    provider.modelCapabilities?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const budgetManager = budgetManagerInstance;
  const inputTokens = estimateMessagesTokens(history);
  let snapshot = budgetManager.snapshot(provider.modelId, maxContextTokens, inputTokens);
  if (runtime.harnessMiddlewareRegistry) {
    const budget = await runtime.harnessMiddlewareRegistry.dispatch({
      type: "context-budget",
      conversationId,
      modelId: provider.modelId,
      maxContextTokens,
      estimatedInputTokens: inputTokens,
    });
    snapshot =
      budget.snapshot ?? ({ ...snapshot, utilizationRatio: 0, compressionStage: "none" } as const);
  }

  let effectiveHistory = history;
  if (budgetManager.shouldCompact(snapshot)) {
    const compactionStartedAt = Date.now();
    const beforeMessageCount = history.length;
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

    logger.debug("context", "context.budget-compacted", {
      conversationId,
      stage: snapshot.compressionStage,
      utilizationRatio: snapshot.utilizationRatio,
      beforeMessageCount,
      afterMessageCount: effectiveHistory.length,
      beforeEstimatedTokens: inputTokens,
      afterEstimatedTokens: estimateMessagesTokens(effectiveHistory),
      durationMs: Date.now() - compactionStartedAt,
    });
  }

  effectiveHistory = normalizeLatestUserMessage(effectiveHistory, normalizedUserInput);

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
  let compatibleRoutedSkills: typeof skillStore.skills = [];
  let routeReasons = new Map<string, string[]>();
  if (lastUserMessage) {
    if (runtime.harnessMiddlewareRegistry) {
      const routing = await runtime.harnessMiddlewareRegistry.dispatch({
        type: "skill-routing",
        conversationId,
        mode,
        userInput: normalizedUserInput,
        skills: skillStore.skills,
        enabledSkillIds: skillStore.enabledSkillIds,
        matchedSkillIds: [],
        matchReasons: {},
      });
      const matched = new Set(routing.matchedSkillIds);
      compatibleRoutedSkills = skillStore.skills.filter((skill) => matched.has(skill.manifest.id));
      routeReasons = new Map(Object.entries(routing.matchReasons));
    } else {
      const routeResult = routeSkill(
        normalizedUserInput,
        skillStore.skills,
        skillStore.enabledSkillIds,
      );
      compatibleRoutedSkills = routeResult.matchedSkills.filter(
        (skill) => mode !== "ask" || skill.manifest.capabilities.length === 0,
      );
      routeReasons = routeResult.matchReasons;
    }
  }
  const activeSkillIds = new Set([
    ...compatibleExplicitSkillIds,
    ...compatibleRoutedSkills.map((skill) => skill.manifest.id),
  ]);
  logger.info("skill", "skill.routing-completed", {
    conversationId,
    mode,
    explicitSkillCount: compatibleExplicitSkillIds.size,
    routedSkillCount: compatibleRoutedSkills.length,
    activeSkillIds: [...activeSkillIds],
  });
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
      logger.warn("skill", "skill.context-rejected", {
        conversationId,
        activeSkillIds: [...activeSkillIds],
        estimatedTokens: estimateTokens(activeSkills),
        skillTokenBudget,
      });
      if (visibleForConversation(get, conversationId)) set({ error: "chat.skillContextTooLarge" });
      return;
    }
    const routeInfo = compatibleRoutedSkills.map((skill) => {
      const reasons = routeReasons.get(skill.manifest.id) ?? [];
      return `- ${skill.manifest.name}: ${reasons.join(", ")}`;
    });
    const explicitInfo = skillStore.skills
      .filter((skill) => compatibleExplicitSkillIds.has(skill.manifest.id))
      .map((skill) => `- ${skill.manifest.name}: explicitly selected by user`);
    const routingLines = [...explicitInfo, ...routeInfo];
    if (routingLines.length > 0) {
      skillRouting = `Active skills:\n${routingLines.join("\n")}`;
    }
    if (lastUserMessage) {
      const activeSkillSummaries = skillStore.skills
        .filter((skill) => activeSkillIds.has(skill.manifest.id))
        .map((skill) => ({ id: skill.manifest.id, name: skill.manifest.name }));
      const messageWithSkills = { ...lastUserMessage, activeSkills: activeSkillSummaries };
      if (!get().privateSession) {
        await getStructuredStorage().write("messages", messageWithSkills.id, messageWithSkills);
      }
      if (visibleForConversation(get, conversationId)) {
        set(({ messages: currentMessages }) => ({
          messages: currentMessages.map((message) =>
            message.id === messageWithSkills.id ? messageWithSkills : message,
          ),
        }));
      }
      logger.info("skill", "skill.context-loaded", {
        conversationId,
        activeSkillIds: [...activeSkillIds],
        activeSkillCount: activeSkillIds.size,
        estimatedTokens: estimateTokens(activeSkills),
      });
    }
  }
  // Resolve memory from storage for every request so startup and settings-page state
  // cannot affect whether global/workspace/conversation memories reach the model.
  let memoryContext = "";
  let relevantMemoryIds: string[] = [];
  if (!get().privateSession) {
    const memoryStartedAt = Date.now();
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
    const maxCharacters = Math.min(6_000, Math.floor(remainingAfterHistoryAndSkills * 0.15) * 4);
    if (runtime.harnessMiddlewareRegistry) {
      const retrieval = await runtime.harnessMiddlewareRegistry.dispatch({
        type: "memory-retrieval",
        conversationId,
        storage: getStructuredStorage(),
        workspacePath: runtime.getWorkspaceRoot?.() ?? null,
        query: normalizedUserInput,
        maxCharacters,
        context: "",
        memories: [],
        memoryIds: [],
      });
      memoryContext = retrieval.context;
      relevantMemoryIds = retrieval.memoryIds;
    } else {
      try {
        const retrieval = await retrieveMemoryContext(getStructuredStorage(), {
          conversationId,
          workspacePath: runtime.getWorkspaceRoot?.() ?? null,
          query: normalizedUserInput,
          maxCharacters,
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
    logger.debug("memory", "memory.retrieval-completed", {
      conversationId,
      selectedCount: relevantMemoryIds.length,
      contextCharacters: memoryContext.length,
      maxCharacters,
      durationMs: Date.now() - memoryStartedAt,
    });
  }
  if (snapshot.compressionStage === "checkpoint-compaction" && !get().privateSession) {
    const objective =
      history.find((message) => message.role === "user")?.content.slice(0, 200) ??
      "Unknown objective";
    if (runtime.harnessMiddlewareRegistry) {
      await runtime.harnessMiddlewareRegistry.dispatch({
        type: "checkpoint",
        conversationId,
        privateSession: false,
        compressionStage: snapshot.compressionStage,
        messages: effectiveHistory,
        objective,
        mode,
        relevantMemoryIds,
        persistCheckpoint: () =>
          createCheckpoint(conversationId, effectiveHistory, objective, {
            mode,
            relevantMemoryIds,
          }).then(() => undefined),
        persisted: false,
      });
    } else {
      try {
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
  }
  const fileReferences = await latestFileReferences(conversationId, get().latestAgentRun);
  const personalization = get().privateSession
    ? ""
    : buildPersonalizationPrompt(await loadPersonalizationPreferences());
  const { systemPrompt } = contextBuilder.buildSystemPrompt({
    modeRules: hint,
    ...(mode === "agent" || mode === "goal" || mode === "plan"
      ? { runCapsule: serializeCapsule(buildRunCapsule(effectiveHistory)) }
      : {}),
    activeSkills,
    skillRouting,
    memory: memoryContext,
    fileReferences,
    personalization,
    workspaceContext: collectWorkspaceContext(),
  });
  if (systemPrompt) messages.unshift({ role: "system", content: systemPrompt });

  const result = await getLoopResult(
    provider,
    conversationId,
    messages,
    set,
    get,
    mode,
    runtime,
    get().privateSession,
  );
  if (result.turns.length === 0) {
    // A user denial (or stop) deliberately ends the run here; surfacing the
    // generic "stream ended unexpectedly" error for it would be wrong.
    const lastMessage = get()
      .messages.filter((m) => m.conversationId === conversationId)
      .at(-1);
    const endedByDenial =
      lastMessage?.toolResults?.some(({ error }) => error === TOOL_DENIED) ?? false;
    if (!endedByDenial && visibleForConversation(get, conversationId)) {
      set({ error: "chat.streamEnded" });
    }
    return;
  }

  const lastTurn = result.turns[result.turns.length - 1];
  const approvalContexts =
    result.approvalContexts ??
    (lastTurn?.pendingApproval
      ? [
          {
            runId: "",
            nodeId: "",
            mode: "agent" as const,
            allowedToolIds: runtime.toolRegistry?.listForMode("agent").map(({ id }) => id) ?? [],
            messages: result.messages,
            turn: lastTurn,
            agentRun: result.agentRun,
          },
        ]
      : []);
  const pendingApprovals = approvalContexts.flatMap((context) => {
    const blocked = context.turn.pendingApproval;
    if (!blocked) return [];
    return [
      {
        approvalId: crypto.randomUUID(),
        toolCallId: blocked.toolCallId,
        toolName: blocked.toolName,
        args: blocked.args,
        ...(blocked.riskLevel ? { riskLevel: blocked.riskLevel } : {}),
        ...(blocked.source ? { source: blocked.source } : {}),
        ...(blocked.approval ? { approval: blocked.approval } : {}),
        ...(blocked.workspaceRoot !== undefined ? { workspaceRoot: blocked.workspaceRoot } : {}),
        conversationId,
        messages: context.messages,
        providerId: provider.id,
        turn: context.turn,
        agentRun: context.agentRun,
        ...(context.mode !== "ask" ? { mode: context.mode } : {}),
        allowedToolIds: context.allowedToolIds,
        ...(context.runId && context.nodeId
          ? { orchestration: { runId: context.runId, nodeId: context.nodeId } }
          : {}),
      } satisfies PendingToolApproval,
    ];
  });

  if (pendingApprovals.length > 0 && (mode === "agent" || mode === "goal")) {
    logger.info("approval", "approval.requested", {
      conversationId,
      count: pendingApprovals.length,
      tools: pendingApprovals.map(({ toolName, riskLevel }) => ({ toolName, riskLevel })),
    });
    const blockedTurns = new Set(approvalContexts.map(({ turn }) => turn));
    const earlierTurns = result.turns.filter((turn) => !blockedTurns.has(turn));
    const messageTimestamp = Date.now();
    const earlierMessages = earlierTurns.map((turn, index) =>
      toMessage(turn, conversationId, undefined, messageTimestamp + index),
    );
    if (earlierMessages.length > 0) {
      const conversation = get().conversations.find(({ id }) => id === conversationId);
      const title = titleFor(history, Boolean(conversation?.title));
      if (!get().privateSession) await persistResponse(earlierMessages, conversationId, title);
    }

    const blockedMessages = approvalContexts.map(({ turn }, index) =>
      toMessage(turn, conversationId, undefined, messageTimestamp + earlierMessages.length + index),
    );
    const [pendingApproval, ...remainingApprovals] = pendingApprovals;
    if (!pendingApproval) return;
    if (!get().privateSession) {
      await getStructuredStorage().writeMany(
        "approvals",
        pendingApprovals.map((pending) => toApprovalRecord(pending)),
      );
    }
    const agentRunRecord = await buildAgentRunRecord(result, conversationId, runtime, {
      previous:
        get().latestAgentRun?.id === result.agentRun.id
          ? get().latestAgentRun
          : get().privateSession
            ? null
            : await getStructuredStorage().read<AgentRunRecord>("agent_runs", result.agentRun.id),
    });
    if (!get().privateSession) await persistAgentRun(agentRunRecord);

    set(({ conversations, currentConversationId, messages: currentMessages }) => ({
      conversations: sorted(
        conversations.map((item) =>
          item.id === conversationId ? { ...item, updatedAt: Date.now() } : item,
        ),
      ),
      ...(currentConversationId === conversationId
        ? { messages: [...currentMessages, ...earlierMessages, ...blockedMessages] }
        : {}),
    }));
    // The approval belongs to THIS conversation whether or not it is on
    // screen: concurrent tasks can each wait on their own approval.
    setPendingApproval(set, get, conversationId, { ...pendingApproval, remainingApprovals });
    if (visibleForConversation(get, conversationId)) {
      set({ latestAgentRun: agentRunRecord });
    }
    return;
  }

  const messageTimestamp = Date.now();
  const assistants = result.turns.map((turn, index) =>
    toMessage(turn, conversationId, undefined, messageTimestamp + index),
  );
  const title = titleFor(history, Boolean(conversation?.title));
  const updatedAt = get().privateSession
    ? Date.now()
    : await persistResponse(assistants, conversationId, title);
  const lastStream: StreamResult | undefined = result.turns.at(-1)?.stream;
  const error = result.maxIterationsReached ? "tools.maxIterations" : lastStream?.errorMessage;
  let agentRunRecord =
    mode === "agent" || mode === "goal"
      ? await buildAgentRunRecord(result, conversationId, runtime, {
          previous:
            get().latestAgentRun?.id === result.agentRun.id
              ? get().latestAgentRun
              : get().privateSession
                ? null
                : await getStructuredStorage().read<AgentRunRecord>(
                    "agent_runs",
                    result.agentRun.id,
                  ),
        })
      : null;
  if (agentRunRecord && !get().privateSession) {
    await persistAgentRun(agentRunRecord);
    agentRunRecord = await finalizeAutomaticVerification(agentRunRecord, runtime);
  }

  // Sidebar status bookkeeping: background runs record their settled outcome
  // even when the conversation is not on screen.
  const lastTurnForOutcome = result.turns.at(-1);
  const stoppedMidRun = lastTurnForOutcome?.stream.status === "stopped";
  const failed = Boolean(error) || agentRunRecord?.status === "failed";
  set((state) => ({
    runOutcomes: {
      ...state.runOutcomes,
      [conversationId]: {
        status: stoppedMidRun ? "stopped" : failed ? "failed" : "completed",
        at: Date.now(),
      },
    },
  }));

  // After a Stop the conversation's slot is gone and this tail must still land
  // (persisting the partial content); but if a NEWER run already owns the same
  // conversation, applying this tail would append stale turns on top of it.
  const ownsStreamSlot = ownsConversationSlot(get, conversationId, streamStartedAt);
  set(({ conversations, currentConversationId, messages: currentMessages }) => ({
    conversations: sorted(
      conversations.map((item) =>
        item.id === conversationId ? { ...item, updatedAt, ...(title ? { title } : {}) } : item,
      ),
    ),
    ...(ownsStreamSlot && currentConversationId === conversationId
      ? { messages: [...currentMessages, ...assistants] }
      : {}),
    ...(ownsStreamSlot && currentConversationId === conversationId
      ? {
          streamingContent: "",
          error: error ?? null,
          latestAgentRun: agentRunRecord,
        }
      : {}),
  }));
}
