import { getRuntime } from "../../runtime/use-runtime";
import { approveCurrentPlan, submitClarifications } from "./orchestration-session";
import { useOrchestrationStore } from "./orchestration-store";
import { useProviderStore } from "../provider/provider-store";
import { ModelPlanGenerator } from "./model-plan-generator";
import { slotFor } from "../chat/stream-ownership";
import type { ChatState } from "../chat/chat-contracts";

// The chat-store / send-message imports are deliberately dynamic: this module
// sits at the orchestration→chat continuation edge, and static imports here
// close the chat-store ⇄ send-message ⇄ tool-approval ⇄ orchestration cycle
// (§circular-dependency governance).
type ChatStoreApi = {
  getState: () => ChatState & {
    messages: ChatState["messages"];
    selectedSkillIds: ChatState["selectedSkillIds"];
    privateSession: boolean;
    currentConversationId: string | null;
  };
  setState: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;
};

async function chatStore(): Promise<ChatStoreApi> {
  const { useChatStore } = await import("../chat/chat-store");
  return useChatStore;
}

export async function continueCurrentExecution(conversationId?: string): Promise<void> {
  const store = await chatStore();
  const chat = store.getState();
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
  const { executePreparedStream } = await import("../chat/send-message");
  await executePreparedStream(
    store.setState,
    store.getState,
    history,
    current.conversationId,
    chat.selectedSkillIds,
  );
}

async function loadHistoryFor(conversationId: string) {
  const { getStructuredStorage } = await import("../../runtime/structured-storage");
  const messages = await getStructuredStorage().query<ChatState["messages"][number]>("messages", {
    conversationId,
  });
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return messages;
}

export async function answerCurrentClarifications(
  answers: Readonly<Record<string, string>>,
): Promise<void> {
  const chat = (await chatStore()).getState();
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
  const chat = (await chatStore()).getState();
  const conversationId = useOrchestrationStore.getState().current?.conversationId ?? undefined;
  if (await approveCurrentPlan(getRuntime(), chat.privateSession, conversationId))
    await continueCurrentExecution(conversationId);
}
