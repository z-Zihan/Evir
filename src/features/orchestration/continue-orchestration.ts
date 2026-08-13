import { getRuntime } from "../../runtime/use-runtime";
import { useChatStore } from "../chat/chat-store";
import { executePreparedStream } from "../chat/send-message";
import { approveCurrentPlan, submitClarifications } from "./orchestration-session";
import { useOrchestrationStore } from "./orchestration-store";
import { useProviderStore } from "../provider/provider-store";
import { ModelPlanGenerator } from "./model-plan-generator";

export async function continueCurrentExecution(): Promise<void> {
  const chat = useChatStore.getState();
  const current = useOrchestrationStore.getState().current;
  if (!current || chat.isStreaming || chat.currentConversationId !== current.conversationId) return;
  await executePreparedStream(
    useChatStore.setState,
    useChatStore.getState,
    chat.messages,
    current.conversationId,
    chat.selectedSkillIds,
  );
}

export async function answerCurrentClarifications(
  answers: Readonly<Record<string, string>>,
): Promise<void> {
  const chat = useChatStore.getState();
  const provider = useProviderStore.getState().getDefaultProvider();
  const result = await submitClarifications(
    answers,
    getRuntime(),
    chat.privateSession,
    provider ? new ModelPlanGenerator(provider) : undefined,
  );
  if (result === "ready") await continueCurrentExecution();
}

export async function confirmCurrentPlan(): Promise<void> {
  const chat = useChatStore.getState();
  if (await approveCurrentPlan(getRuntime(), chat.privateSession)) await continueCurrentExecution();
}
