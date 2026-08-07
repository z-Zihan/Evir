import type { MessageRecord, SettingRecord } from "../storage/db";
import { estimateMessagesTokens } from "./token-estimate";
import { getStructuredStorage } from "../../runtime/structured-storage";

export interface Checkpoint {
  id: string;
  conversationId: string;
  createdAt: number;
  messageCount: number;
  tokenEstimate: number;
  summary: string;
  objective: string;
  completedSteps: string[];
  pendingSteps: string[];
  unresolvedErrors: string[];
}

/**
 * Create a checkpoint when context utilization exceeds 90%.
 * Saves a snapshot of the conversation state to allow recovery.
 */
export async function createCheckpoint(
  conversationId: string,
  messages: MessageRecord[],
  objective: string,
): Promise<Checkpoint> {
  const now = Date.now();
  const tokenEstimate = estimateMessagesTokens(messages);

  // Extract key info from messages
  const completedSteps: string[] = [];
  const pendingSteps: string[] = [];
  const unresolvedErrors: string[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.content) {
      // Look for task completion indicators
      if (
        msg.content.includes("完成") ||
        msg.content.includes("done") ||
        msg.content.includes("✅")
      ) {
        completedSteps.push(msg.content.slice(0, 100));
      }
    }
    if (msg.status === "error" && msg.errorMessage) {
      unresolvedErrors.push(msg.errorMessage);
    }
    if (msg.toolResults) {
      for (const result of msg.toolResults) {
        if (!result.success) {
          unresolvedErrors.push(`${result.toolName}: ${result.output.slice(0, 80)}`);
        }
      }
    }
  }

  const checkpoint: Checkpoint = {
    id: `cp-${now}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    createdAt: now,
    messageCount: messages.length,
    tokenEstimate,
    summary: `Checkpoint at ${new Date(now).toISOString()}: ${messages.length} messages, ~${tokenEstimate} tokens`,
    objective,
    completedSteps,
    pendingSteps,
    unresolvedErrors,
  };

  // Persist checkpoint to settings table
  await getStructuredStorage().write("settings", `checkpoint:${conversationId}`, {
    name: `checkpoint:${conversationId}`,
    value: checkpoint,
  });

  return checkpoint;
}

/**
 * Load the latest checkpoint for a conversation.
 */
export async function loadCheckpoint(conversationId: string): Promise<Checkpoint | null> {
  const record = await getStructuredStorage().read<SettingRecord>(
    "settings",
    `checkpoint:${conversationId}`,
  );
  return (record?.value as Checkpoint | undefined) ?? null;
}

/**
 * Build a handoff message for model switching.
 * Creates a system message that preserves context across model changes.
 */
export function buildHandoffMessage(
  checkpoint: Checkpoint,
  newModelId: string,
): { role: "system"; content: string } {
  const parts: string[] = [`[Model Handoff → ${newModelId}]`, `Objective: ${checkpoint.objective}`];

  if (checkpoint.completedSteps.length > 0) {
    parts.push(`Completed steps:`);
    checkpoint.completedSteps.forEach((s) => parts.push(`  ✅ ${s}`));
  }

  if (checkpoint.pendingSteps.length > 0) {
    parts.push(`Pending steps:`);
    checkpoint.pendingSteps.forEach((s) => parts.push(`  ⏳ ${s}`));
  }

  if (checkpoint.unresolvedErrors.length > 0) {
    parts.push(`Unresolved errors:`);
    checkpoint.unresolvedErrors.forEach((e) => parts.push(`  ❌ ${e}`));
  }

  parts.push(
    `Previous context: ${checkpoint.messageCount} messages (~${checkpoint.tokenEstimate} tokens)`,
  );

  return {
    role: "system",
    content: parts.join("\n"),
  };
}
