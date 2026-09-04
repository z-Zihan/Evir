import type { MessageRecord } from "../../../core/storage/db";
import { formatAttachmentForProvider } from "../attachment-utils";
import { assistantToolCallWireMessage, toolResultWireMessages } from "../agent-loop";

export type ProviderWireMessage = { role: string; content: unknown };

function attachmentMessage(message: MessageRecord, protocolId: string): ProviderWireMessage {
  if (message.role !== "user" || !message.attachments?.length) {
    return { role: message.role, content: message.content };
  }
  const content: unknown[] = [{ type: "text", text: message.content }];
  for (const attachment of message.attachments) {
    content.push(formatAttachmentForProvider(attachment, protocolId));
  }
  return { role: message.role, content };
}

export function providerMessage(message: MessageRecord, protocolId: string): ProviderWireMessage[] {
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

export function providerWireMessages(
  history: MessageRecord[],
  protocolId: string,
): ProviderWireMessage[] {
  return history
    .filter((message) => message.status !== "error")
    .flatMap((message) => providerMessage(message, protocolId));
}

export function normalizeLatestUserMessage(
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
