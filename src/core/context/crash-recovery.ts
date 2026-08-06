import { db } from "../storage/db";
import type { Checkpoint } from "./checkpoint";

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
  const settings = await db.settings.toArray();
  const now = Date.now();
  const runs: UnfinishedRun[] = [];

  for (const setting of settings) {
    if (!setting.name.startsWith("checkpoint:")) continue;
    const cp = setting.value as Checkpoint;
    if (!cp?.id || !cp?.conversationId) continue;

    // Check if the conversation still exists
    const conv = await db.conversations.get(cp.conversationId);
    if (!conv) continue;

    // Check if there are messages after the checkpoint
    const messages = await db.messages
      .where("conversationId")
      .equals(cp.conversationId)
      .sortBy("createdAt");

    const lastMessage = messages[messages.length - 1];
    const hasNewMessages = lastMessage && lastMessage.createdAt > cp.createdAt;

    // If no new messages after checkpoint, it was likely interrupted
    if (!hasNewMessages && cp.unresolvedErrors.length > 0) {
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
  await db.settings.delete(`checkpoint:${conversationId}`);
}
