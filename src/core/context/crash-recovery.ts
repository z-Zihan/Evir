import type { ConversationRecord, MessageRecord, SettingRecord } from "../storage/db";
import { normalizeCheckpoint, type Checkpoint } from "./checkpoint";
import { getStructuredStorage } from "../../runtime/structured-storage";

export interface UnfinishedRun {
  conversationId: string;
  checkpoint: Checkpoint;
  age: number; // ms since checkpoint
}

/**
 * Scan for unfinished checkpoints on app startup.
 * Returns runs that were interrupted and may need recovery.
 */
export async function findUnfinishedRuns(): Promise<UnfinishedRun[]> {
  const storage = getStructuredStorage();
  const settings = await storage.readAll<SettingRecord>("settings");
  const now = Date.now();
  const runs: UnfinishedRun[] = [];

  for (const setting of settings) {
    if (!setting.name.startsWith("checkpoint:")) continue;
    const cp = normalizeCheckpoint(setting.value);
    if (!cp) continue;

    // Check if the conversation still exists
    const conv = await storage.read<ConversationRecord>("conversations", cp.conversationId);
    if (!conv) continue;

    // Check if there are messages after the checkpoint
    const messages = await storage.query<MessageRecord>("messages", {
      conversationId: cp.conversationId,
    });
    messages.sort((a, b) => a.createdAt - b.createdAt);

    const lastMessage = messages[messages.length - 1];
    const hasNewMessages = lastMessage && lastMessage.createdAt > cp.createdAt;

    // No message after the checkpoint means the run stopped before reaching a safe completion
    // boundary. Recovery only restores the conversation state; it never replays tools.
    if (!hasNewMessages) {
      runs.push({
        conversationId: cp.conversationId,
        checkpoint: cp,
        age: now - cp.createdAt,
      });
    }
  }

  // Sort by most recent first
  runs.sort((a, b) => b.checkpoint.createdAt - a.checkpoint.createdAt);
  return runs;
}

/**
 * Clear a checkpoint after successful recovery or user dismissal.
 */
export async function clearCheckpoint(conversationId: string): Promise<void> {
  await getStructuredStorage().delete("settings", `checkpoint:${conversationId}`);
}
