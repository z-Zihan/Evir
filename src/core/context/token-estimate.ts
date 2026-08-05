export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 1;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessagesTokens(messages: { content: unknown }[]): number {
  let total = 0;
  for (const message of messages) {
    if (message.content === null || message.content === undefined) continue;
    if (typeof message.content === "string") {
      total += estimateTokens(message.content);
    } else {
      total += estimateTokens(JSON.stringify(message.content));
    }
  }
  return total;
}
