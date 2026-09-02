import { getRuntime } from "../../runtime/use-runtime";
import { useChatStore } from "../chat/chat-store";
import { executePreparedStream } from "../chat/send-message";
import { approveCurrentPlan, submitClarifications } from "./orchestration-session";
import { useOrchestrationStore } from "./orchestration-store";
import { useProviderStore } from "../provider/provider-store";
import { ModelPlanGenerator } from "./model-plan-generator";
import { slotFor } from "../chat/stream-ownership";

export async function continueCurrentExecution(conversationId?: string): Promise<void> {
  const chat = useChatStore.getState();
  const current = useOrchestrationStore
    .getState()
    .snapshotFor(conversationId ?? chat.currentConversationId);
  if (!current) return;
  // A run already in flight for this conversation must not be doubled; other
  // conversations streaming concurrently do not block this one.
  if (slotFor(chat, current.conversationId)) return;
  const history =
    chat.currentConversationId === current.conversationId
      ? chat.messages
      : await loadHistoryFor(current.conversationId);
  await executePreparedStream(
    useChatStore.setState,
    useChatStore.getState,
    history,
    current.conversationId,
    chat.selectedSkillIds,
  );
}

async function loadHistoryFor(conversationId: string) {
  const { getStructuredStorage } = await import("../../runtime/structured-storage");
  const messages = await getStructuredStorage().query<
    ReturnType<typeof useChatStore.getState>["messages"][number]
  >("messages", { conversationId });
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return messages;
}

export async function answerCurrentClarifications(
  answers: Readonly<Record<string, string>>,
): Promise<void> {
  const chat = useChatStore.getState();
  const provider = useProviderStore.getState().getDefaultProvider();
  const conversationId = useOrchestrationStore.getState().current?.conversationId ?? undefined;
  const result = await submitClarifications(
    answers,
    getRuntime(),
    chat.privateSession,
    provider ? new ModelPlanGenerator(provider) : undefined,
    conversationId,
  );
  if (result === "ready") await continueCurrentExecution(conversationId);
}

export async function confirmCurrentPlan(): Promise<void> {
  const chat = useChatStore.getState();
  const conversationId = useOrchestrationStore.getState().current?.conversationId ?? undefined;
  if (await approveCurrentPlan(getRuntime(), chat.privateSession, conversationId))
    await continueCurrentExecution(conversationId);
}
