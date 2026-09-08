import type { MessageRecord } from "../storage/db";

const TRUNCATED_SUFFIX = "... [truncated]";

export interface ToolOutputArchive {
  /** Artifact id the full output was archived under. */
  artifactId: string;
  toolCallId: string;
  toolName: string;
  charCount: number;
}

export interface CompactToolOutputsOptions {
  /**
   * Called once per truncated tool result so the full text survives in the
   * artifacts store (§20: full tool output must stay recoverable, only the
   * in-context copy is compacted). Optional — without it behavior is the
   * plain tail-truncation of v1.
   */
  archiveFullOutput?: (detail: {
    message: MessageRecord;
    toolCallId: string;
    toolName: string;
    output: string;
  }) => Promise<string | undefined>;
}

export async function compactToolOutputs(
  messages: MessageRecord[],
  maxToolOutputChars: number,
  options: CompactToolOutputsOptions = {},
): Promise<MessageRecord[]> {
  const archived: Promise<void>[] = [];
  const result = messages.map((message) => {
    if (!message.toolResults?.length) return message;

    const totalOutput = message.toolResults.reduce((sum, result) => sum + result.output.length, 0);
    if (totalOutput <= maxToolOutputChars) return message;

    return {
      ...message,
      toolResults: message.toolResults.map((result) => {
        if (result.output.length <= maxToolOutputChars) return result;
        const maxChars = maxToolOutputChars - TRUNCATED_SUFFIX.length;
        // Clone first: the store's message objects are never mutated.
        const compacted = {
          ...result,
          output: result.output.slice(0, Math.max(0, maxChars)) + ` ${TRUNCATED_SUFFIX}`,
        };
        if (options.archiveFullOutput) {
          archived.push(
            (async () => {
              try {
                const artifactId = await options.archiveFullOutput!({
                  message,
                  toolCallId: result.toolCallId,
                  toolName: result.toolName,
                  output: result.output,
                });
                if (!artifactId) return;
                // The truncation marker names the artifact so the full text
                // is recoverable from the compacted context itself.
                compacted.output =
                  result.output.slice(0, Math.max(0, maxChars)) +
                  ` ${TRUNCATED_SUFFIX} [full output archived: ${artifactId}]`;
              } catch {
                // Archival must never block compaction — the plain
                // truncated marker stays.
              }
            })(),
          );
        }
        return compacted;
      }),
    };
  });
  if (archived.length > 0) await Promise.all(archived);
  return result;
}
