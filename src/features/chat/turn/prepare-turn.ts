import i18n from "../../../i18n/config";
import type { MessageRecord } from "../../../core/storage/db";
import { compactToolOutputs } from "../../../core/context/compact-tool-outputs";
import { createCheckpoint } from "../../../core/context/checkpoint";
import { createContextBudgetManager } from "../../../core/context/context-budget-manager";
import type { ContextBudgetManager } from "../../../core/context/context-builder";
import { contextBuilder } from "../../../core/context/context-builder";
import { buildRunCapsule, serializeCapsule } from "../../../core/context/run-capsule";
import { estimateMessagesTokens, estimateTokens } from "../../../core/context/token-estimate";
import type { ContextBudgetSnapshot, FileContextReference } from "../../../core/context/types";
import { logger } from "../../../core/logging/logger";
import { retrieveMemoryContext } from "../../../core/memory/memory-retrieval";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "../../../core/providers/model-defaults";
import { requiresToolCalling } from "../../../core/providers/tool-registry";
import { getStructuredStorage } from "../../../runtime/structured-storage";
import { useSkillStore } from "../../skills/skill-store";
import { collectWorkspaceContext } from "../../workspace/workspace-context";
import {
  buildPersonalizationPrompt,
  loadPersonalizationPreferences,
} from "../../settings/personalization-settings";
import { summarizeAndPersist } from "../context-compaction";
import type { AgentRunRecord } from "../agent-run-record";
import { effectiveModeForModel } from "../../projects/conversation-mode";
import { routeSkill } from "../../../core/skills/skill-router";
import type { InstalledSkill } from "../../../core/skills/types";
import { visibleForConversation } from "../stream-ownership";
import type { ChatState } from "../chat-contracts";
import type { PreparedTurn, TurnContext } from "./turn-state";
import { normalizeLatestUserMessage, providerWireMessages } from "./wire-messages";

const budgetManagerInstance: ContextBudgetManager = createContextBudgetManager();

/**
 * prepareTurn — everything a turn needs BEFORE the model is called:
 * mode resolution + capability gates, context budget/compaction, skill
 * routing, memory retrieval, checkpointing, system-prompt assembly.
 * Never executes tools, never writes the final assistant message.
 *
 * Returns `{ blocked: true, reason }` (an i18n error key) when the turn must
 * not start; the orchestrator owns surfacing the error and closing the trace.
 */
export async function prepareTurn(
  turn: TurnContext,
): Promise<{ blocked: true; reason: string } | { blocked: false; turn: PreparedTurn }> {
  const gate = await resolveModeAndGate(turn);
  if (gate.blocked) return { blocked: true, reason: gate.reason };
  const { mode, normalizedUserInput } = gate;

  const { effectiveHistory, snapshot } = await applyContextBudget(turn, normalizedUserInput);

  const skills = await routeAndLoadSkills(
    turn,
    mode,
    normalizedUserInput,
    effectiveHistory,
    snapshot,
  );
  if ("reason" in skills) return { blocked: true, reason: skills.reason };
  const { activeSkills, skillRouting } = skills;

  const memory = await retrieveMemory(
    turn,
    normalizedUserInput,
    effectiveHistory,
    activeSkills,
    skillRouting,
    snapshot,
  );
  if (snapshot.compressionStage === "checkpoint-compaction" && !turn.get().privateSession) {
    await checkpointCompaction(turn, effectiveHistory, mode, memory.relevantMemoryIds);
  }

  const messages = await assembleProviderMessages(turn, {
    mode,
    effectiveHistory,
    activeSkills,
    skillRouting,
    memory: memory.context,
  });

  return {
    blocked: false,
    turn: { mode, normalizedUserInput, effectiveHistory, messages },
  };
}

/** Request middleware: input normalization + mode policy + capability gate. */
async function resolveModeAndGate(
  turn: TurnContext,
): Promise<
  | { blocked: true; reason: string }
  | { blocked: false; mode: ChatState["mode"]; normalizedUserInput: string }
> {
  const { get, runtime, provider, conversationId, lastUserMessage, conversation } = turn;
  const requestedMode = get().mode;
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
      return {
        blocked: true,
        reason:
          request.blockReason === "agent-requires-tool-calling"
            ? "chat.agentRequiresToolCalling"
            : (request.blockReason ?? "chat.streamEnded"),
      };
    }
  }
  if (requiresToolCalling(mode) && provider.modelCapabilities?.toolCalling !== true) {
    return { blocked: true, reason: "chat.agentRequiresToolCalling" };
  }
  return { blocked: false, mode, normalizedUserInput };
}

/**
 * Context budget: estimate tokens, compact tool outputs, and summarize old
 * conversation turns when utilization crosses the configured thresholds.
 * Mutates view state (messages) when a persisted summary replaces history.
 */
async function applyContextBudget(
  turn: TurnContext,
  normalizedUserInput: string,
): Promise<{ effectiveHistory: MessageRecord[]; snapshot: ContextBudgetSnapshot }> {
  const { get, set, runtime, provider, conversationId, history } = turn;
  const maxContextTokens =
    provider.modelCapabilities?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const inputTokens = estimateMessagesTokens(history);
  let snapshot = budgetManagerInstance.snapshot(provider.modelId, maxContextTokens, inputTokens);
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
  if (budgetManagerInstance.shouldCompact(snapshot)) {
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
  return {
    effectiveHistory: normalizeLatestUserMessage(effectiveHistory, normalizedUserInput),
    snapshot,
  };
}

interface ActiveSkills {
  activeSkills: string;
  skillRouting: string;
}

/** Skill routing (explicit selection + trigger matching) with budget enforcement. */
async function routeAndLoadSkills(
  turn: TurnContext,
  mode: ChatState["mode"],
  normalizedUserInput: string,
  effectiveHistory: MessageRecord[],
  snapshot: ContextBudgetSnapshot,
): Promise<ActiveSkills | { reason: string }> {
  const { runtime, conversationId, lastUserMessage, explicitlySelectedSkillIds } = turn;
  const skillStore = useSkillStore.getState();
  const compatibleExplicitSkillIds = new Set(
    [...explicitlySelectedSkillIds].filter((id) => {
      const skill = skillStore.skills.find((candidate) => candidate.manifest.id === id);
      return skill && (mode !== "ask" || skill.manifest.capabilities.length === 0);
    }),
  );
  let compatibleRoutedSkills: InstalledSkill[] = [];
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
  if (activeSkillIds.size === 0) return { activeSkills: "", skillRouting: "" };

  const activeSkills = await skillStore.getSkillContent(activeSkillIds);
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
    return { reason: "chat.skillContextTooLarge" };
  }
  const skillRouting = buildSkillRoutingManifest(skillStore.skills, {
    compatibleExplicitSkillIds,
    compatibleRoutedSkills,
    routeReasons,
  });
  await persistSkillAnnotations(turn, activeSkillIds, activeSkills);
  return { activeSkills, skillRouting };
}

function buildSkillRoutingManifest(
  skills: InstalledSkill[],
  matched: {
    compatibleExplicitSkillIds: Set<string>;
    compatibleRoutedSkills: InstalledSkill[];
    routeReasons: Map<string, string[]>;
  },
): string {
  const routeInfo = matched.compatibleRoutedSkills.map((skill) => {
    const reasons = matched.routeReasons.get(skill.manifest.id) ?? [];
    return `- ${skill.manifest.name}: ${reasons.join(", ")}`;
  });
  const explicitInfo = skills
    .filter((skill) => matched.compatibleExplicitSkillIds.has(skill.manifest.id))
    .map((skill) => `- ${skill.manifest.name}: explicitly selected by user`);
  const routingLines = [...explicitInfo, ...routeInfo];
  return routingLines.length > 0 ? `Active skills:\n${routingLines.join("\n")}` : "";
}

/** Persist which skills were active onto the user message (non-private runs). */
async function persistSkillAnnotations(
  turn: TurnContext,
  activeSkillIds: Set<string>,
  activeSkills: string,
): Promise<void> {
  const { set, get, conversationId, lastUserMessage } = turn;
  if (!lastUserMessage) return;
  const skillStore = useSkillStore.getState();
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

/**
 * Resolve memory from storage for every request so startup and settings-page
 * state cannot affect whether global/workspace/conversation memories reach the
 * model.
 */
async function retrieveMemory(
  turn: TurnContext,
  normalizedUserInput: string,
  effectiveHistory: MessageRecord[],
  activeSkills: string,
  skillRouting: string,
  snapshot: ContextBudgetSnapshot,
): Promise<{ context: string; relevantMemoryIds: string[] }> {
  const { get, runtime, conversationId } = turn;
  if (get().privateSession) return { context: "", relevantMemoryIds: [] };
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
  let context = "";
  let relevantMemoryIds: string[] = [];
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
    context = retrieval.context;
    relevantMemoryIds = retrieval.memoryIds;
  } else {
    try {
      const retrieval = await retrieveMemoryContext(getStructuredStorage(), {
        conversationId,
        workspacePath: runtime.getWorkspaceRoot?.() ?? null,
        query: normalizedUserInput,
        maxCharacters,
      });
      context = retrieval.context;
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
    contextCharacters: context.length,
    maxCharacters,
    durationMs: Date.now() - memoryStartedAt,
  });
  return { context, relevantMemoryIds };
}

/** Forced checkpoint before context is dropped at >90% utilization. */
async function checkpointCompaction(
  turn: TurnContext,
  effectiveHistory: MessageRecord[],
  mode: ChatState["mode"],
  relevantMemoryIds: string[],
): Promise<void> {
  const { runtime, conversationId, history } = turn;
  const objective =
    history.find((message) => message.role === "user")?.content.slice(0, 200) ??
    "Unknown objective";
  if (runtime.harnessMiddlewareRegistry) {
    await runtime.harnessMiddlewareRegistry.dispatch({
      type: "checkpoint",
      conversationId,
      privateSession: false,
      compressionStage: "checkpoint-compaction",
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
    return;
  }
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

function modeHint(mode: ChatState["mode"]): string {
  if (mode === "agent") return i18n.t("chat.modeHints.agent");
  if (mode === "plan") return i18n.t("chat.modeHints.plan");
  if (mode === "goal") return i18n.t("chat.modeHints.goal");
  return "";
}

/** Assemble the final provider message array (system prompt first). */
async function assembleProviderMessages(
  turn: TurnContext,
  parts: {
    mode: ChatState["mode"];
    effectiveHistory: MessageRecord[];
    activeSkills: string;
    skillRouting: string;
    memory: string;
  },
): Promise<{ role: string; content: unknown }[]> {
  const { get, provider, conversationId } = turn;
  const fileReferences = await latestFileReferences(conversationId, get().latestAgentRun);
  const personalization = get().privateSession
    ? ""
    : buildPersonalizationPrompt(await loadPersonalizationPreferences());
  const { systemPrompt } = contextBuilder.buildSystemPrompt({
    modeRules: modeHint(parts.mode),
    ...(parts.mode === "agent" || parts.mode === "goal" || parts.mode === "plan"
      ? { runCapsule: serializeCapsule(buildRunCapsule(parts.effectiveHistory)) }
      : {}),
    activeSkills: parts.activeSkills,
    skillRouting: parts.skillRouting,
    memory: parts.memory,
    fileReferences,
    personalization,
    workspaceContext: collectWorkspaceContext(),
  });
  const messages = providerWireMessages(parts.effectiveHistory, provider.protocolId);
  if (systemPrompt) messages.unshift({ role: "system", content: systemPrompt });
  return messages;
}
