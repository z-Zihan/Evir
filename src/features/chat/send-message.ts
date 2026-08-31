import type { StoreApi } from "zustand";
import type { ConversationRecord, MessageRecord, ProviderRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import type { ChatState } from "./chat-store";
import { providerReadinessError } from "./chat-stream";
import { streamResponse } from "./stream-response";
import { getRuntime } from "../../runtime/use-runtime";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { logger } from "../../core/logging/logger";
import { prepareTask } from "../orchestration/orchestration-session";
import { ModelTaskIntakeAnalyzer } from "../orchestration/model-task-intake-analyzer";
import { ModelPlanGenerator } from "../orchestration/model-plan-generator";
import { effectiveModeForModel } from "../projects/conversation-mode";

const DONE_WHEN_MARKER = /^(?:done\s+when|完成条件|验收条件)\s*[:：]?\s*$/i;
const DONE_WHEN_INLINE = /(?:done\s+when|完成条件|验收条件)\s*[:：]\s*(.+)$/i;

/** Goal mode: lines after a "Done when" marker become checklist conditions. */
export function parseDoneWhen(text: string): string[] {
  const lines = text.split("\n").map((line) => line.trim());
  const inline = lines
    .map((line) => DONE_WHEN_INLINE.exec(line)?.[1])
    .find((captured): captured is string => Boolean(captured));
  if (inline) {
    return inline
      .split(/[;；]/)
      .map((condition) => condition.trim())
      .filter((condition) => condition.length > 0)
      .slice(0, 10);
  }
  const markerIndex = lines.findIndex((line) => DONE_WHEN_MARKER.test(line));
  if (markerIndex === -1) return [];
  const afterMarker = lines.slice(markerIndex + 1);
  const conditions: string[] = [];
  for (const line of afterMarker) {
    if (line.length === 0 && conditions.length > 0) break;
    const condition = line.replace(/^[-*•\d.)\s]+/, "").trim();
    if (condition.length > 0) conditions.push(condition);
    if (conditions.length >= 10) break;
  }
  return conditions;
}
import { useProjectStore } from "../projects/project-store";

type ChatStoreSet = StoreApi<ChatState>["setState"];
type ChatStoreGet = StoreApi<ChatState>["getState"];

export async function executePreparedStream(
  set: ChatStoreSet,
  get: ChatStoreGet,
  history: MessageRecord[],
  conversationId: string,
  selectedSkillIds?: ReadonlySet<string>,
): Promise<void> {
  const runtime = getRuntime();
  await streamResponse(set, get, history, conversationId, runtime, selectedSkillIds);
}

export async function sendChatMessage(
  set: ChatStoreSet,
  get: ChatStoreGet,
  rawText: string,
): Promise<boolean> {
  const text = rawText.trim();
  if ((!text && get().pendingAttachments.length === 0) || get().isStreaming) return false;
  const provider = useProviderStore.getState().getDefaultProvider();
  if (!provider) {
    set({ error: "chat.noProvider" });
    return false;
  }
  const readinessError = providerReadinessError(provider);
  if (readinessError) {
    set({ error: readinessError });
    return false;
  }

  // Flip the busy flag synchronously, BEFORE the first await: agent/goal
  // preparation runs two LLM round trips before beginConversationStream fires,
  // and without this window a second send starts a concurrent run.
  set({ isStreaming: true });
  try {
    await sendChatMessageInner(set, get, text, provider);
  } catch (error) {
    // Pre-acceptance failure: the user message never reached the conversation,
    // so the caller must keep the draft on screen instead of silently
    // discarding it.
    logger.error("provider", "chat.send-failed", {
      conversationId: get().currentConversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    set({
      error: "chat.sendFailed",
      isStreaming: get().activeStreamConversationId !== null ? get().isStreaming : false,
    });
    return false;
  } finally {
    // Early exits (cancelled/clarification/confirmation/preparation failure)
    // never open a stream slot — reset the flag so the composer re-enables.
    // When a stream did run, it has already finished and this is a no-op.
    if (get().activeStreamConversationId === null) {
      set({ isStreaming: false });
    }
  }
  return true;
}

async function sendChatMessageInner(
  set: ChatStoreSet,
  get: ChatStoreGet,
  text: string,
  provider: ProviderRecord,
): Promise<void> {
  const attachments = get().pendingAttachments;
  const selectedSkillIds = new Set(get().selectedSkillIds);
  let conversationId = get().currentConversationId;
  if (!conversationId) {
    // New threads inherit the active project context; standalone chats pass null.
    const projectId = useProjectStore.getState().currentProjectId;
    conversationId = await get().createConversation(provider.id, provider.modelId, projectId);
  }
  const history = get().messages;
  const now = Date.now();
  const userMessage: MessageRecord = {
    id: crypto.randomUUID(),
    conversationId,
    role: "user",
    content: text,
    status: "complete",
    createdAt: now,
  };
  if (attachments.length > 0) {
    userMessage.attachments = attachments.map((attachment) => ({
      id: attachment.id,
      messageId: userMessage.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      data: attachment.data,
      type: attachment.type,
      createdAt: now,
    }));
  }
  const storage = getStructuredStorage();
  if (!get().privateSession) {
    await storage.write("messages", userMessage.id, userMessage);
  }

  // Auto-generate title
  const conversation = get().conversations.find((c) => c.id === conversationId);
  if (conversation && !conversation.title && text) {
    const autoTitle = text.length > 30 ? `${text.slice(0, 30)}…` : text;
    const storedConversation = await storage.read<ConversationRecord>(
      "conversations",
      conversationId,
    );
    if (storedConversation && !get().privateSession) {
      await storage.write("conversations", conversationId, {
        ...storedConversation,
        title: autoTitle,
        updatedAt: Date.now(),
      });
    }
    set(({ conversations: convs }) => ({
      conversations: convs.map((c) => (c.id === conversationId ? { ...c, title: autoTitle } : c)),
    }));
  }

  if (attachments.length > 0) {
    if (!get().privateSession) {
      await storage.writeMany(
        "attachments",
        attachments.map((attachment) => ({
          ...attachment,
          messageId: userMessage.id,
          createdAt: now,
        })),
      );
    }
  }
  set({
    messages: [...history, userMessage],
    pendingAttachments: [],
    selectedSkillIds: new Set<string>(),
    latestAgentRun: null,
  });
  const nextHistory = [...history, userMessage];
  let preparation: Awaited<ReturnType<typeof prepareTask>> = "not-applicable";
  const conversationRecord = get().conversations.find((c) => c.id === conversationId);
  const runMode = effectiveModeForModel(
    conversationRecord,
    get().mode,
    provider.modelCapabilities?.toolCalling === true,
  );
  if (runMode === "agent" || runMode === "goal") {
    try {
      preparation = await prepareTask({
        objective: text,
        conversationId,
        runtime: getRuntime(),
        privateSession: get().privateSession,
        ...(runMode === "goal" ? { doneWhen: parseDoneWhen(text) } : {}),
        analyzer: new ModelTaskIntakeAnalyzer(
          provider,
          history
            .filter(
              (message): message is MessageRecord & { role: "user" | "assistant" } =>
                (message.role === "user" || message.role === "assistant") &&
                message.content.trim().length > 0,
            )
            .slice(-8)
            .map(({ role, content }) => ({ role, content })),
        ),
        planner: new ModelPlanGenerator(provider),
      });
    } catch {
      set({ error: "orchestration.preparationFailed" });
      return;
    }
  }
  if (
    preparation === "cancelled" ||
    preparation === "clarification" ||
    preparation === "confirmation"
  )
    return;
  if (preparation === "ready") {
    await executePreparedStream(set, get, nextHistory, conversationId, selectedSkillIds);
    return;
  }
  await streamResponse(set, get, nextHistory, conversationId, getRuntime(), selectedSkillIds);
}
