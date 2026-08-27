import type { StoreApi } from "zustand";
import type { ConversationRecord, MessageRecord } from "../../core/storage/db";
import { useProviderStore } from "../provider/provider-store";
import type { ChatState } from "./chat-store";
import { providerReadinessError } from "./chat-stream";
import { streamResponse } from "./stream-response";
import { getRuntime } from "../../runtime/use-runtime";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { prepareTask } from "../orchestration/orchestration-session";
import { ModelTaskIntakeAnalyzer } from "../orchestration/model-task-intake-analyzer";
import { ModelPlanGenerator } from "../orchestration/model-plan-generator";

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
): Promise<void> {
  const text = rawText.trim();
  if ((!text && get().pendingAttachments.length === 0) || get().isStreaming) return;
  const provider = useProviderStore.getState().getDefaultProvider();
  if (!provider) return set({ error: "chat.noProvider" });
  const readinessError = providerReadinessError(provider);
  if (readinessError) return set({ error: readinessError });

  const attachments = get().pendingAttachments;
  const selectedSkillIds = new Set(get().selectedSkillIds);
  let conversationId = get().currentConversationId;
  if (!conversationId)
    conversationId = await get().createConversation(provider.id, provider.modelId);
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
  if (get().mode === "agent") {
    try {
      preparation = await prepareTask({
        objective: text,
        conversationId,
        runtime: getRuntime(),
        privateSession: get().privateSession,
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
