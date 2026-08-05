import type { MessageRecord } from "../../core/storage/db";
import type { AgentLoopTurn } from "./agent-loop";
import type { ChatState } from "./chat-store";

export function toMessage(
  turn: AgentLoopTurn,
  conversationId: string,
  content?: string,
): MessageRecord {
  return {
    id: crypto.randomUUID(),
    conversationId,
    role: "assistant",
    content: content ?? turn.stream.content,
    status: turn.stream.status,
    ...(turn.stream.errorMessage ? { errorMessage: turn.stream.errorMessage } : {}),
    ...(turn.toolCalls?.length ? { toolCalls: turn.toolCalls } : {}),
    ...(turn.toolResults?.length ? { toolResults: turn.toolResults } : {}),
    createdAt: Date.now(),
  };
}

export function sorted(conversations: ChatState["conversations"]): ChatState["conversations"] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}
