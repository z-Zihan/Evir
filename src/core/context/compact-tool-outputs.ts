import type { MessageRecord } from "../storage/db";

const TRUNCATED_SUFFIX = "... [truncated]";

export function compactToolOutputs(
  messages: MessageRecord[],
  maxToolOutputChars: number,
): MessageRecord[] {
  return messages.map((message) => {
    if (!message.toolResults?.length) return message;

    const totalOutput = message.toolResults.reduce((sum, result) => sum + result.output.length, 0);
    if (totalOutput <= maxToolOutputChars) return message;

    return {
      ...message,
      toolResults: message.toolResults.map((result) => {
        if (result.output.length <= maxToolOutputChars) return result;
        const maxChars = maxToolOutputChars - TRUNCATED_SUFFIX.length;
        return {
          ...result,
          output: result.output.slice(0, Math.max(0, maxChars)) + TRUNCATED_SUFFIX,
        };
      }),
    };
  });
}
