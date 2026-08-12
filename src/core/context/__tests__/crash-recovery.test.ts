import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type ConversationRecord, type SettingRecord } from "../../storage/db";
import type { Checkpoint } from "../checkpoint";
import { clearCheckpoint, findUnfinishedRuns } from "../crash-recovery";

const conversation: ConversationRecord = {
  id: "conversation-1",
  title: "Interrupted task",
  providerId: "provider-1",
  modelId: "model-1",
  createdAt: 1,
  updatedAt: 1,
};

function checkpoint(createdAt = 100): Checkpoint {
  return {
    id: "checkpoint-1",
    conversationId: conversation.id,
    createdAt,
    messageCount: 1,
    tokenEstimate: 10,
    summary: "checkpoint",
    objective: "Finish task",
    completedSteps: [],
    pendingSteps: ["verify"],
    unresolvedErrors: [],
    userConstraints: [],
    approvals: [],
    changedArtifacts: [],
    verificationEvidence: [],
    relevantMemoryIds: [],
    contextSummaryVersion: "1",
    mode: "agent",
  };
}

describe("crash recovery discovery", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.conversations.put(conversation);
  });

  it("finds a checkpoint with no later message even when there was no error", async () => {
    const record: SettingRecord = {
      name: `checkpoint:${conversation.id}`,
      value: checkpoint(),
    };
    await db.settings.put(record);

    const runs = await findUnfinishedRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.checkpoint.objective).toBe("Finish task");
  });

  it("does not offer recovery after the run progressed beyond its checkpoint", async () => {
    await db.settings.put({
      name: `checkpoint:${conversation.id}`,
      value: checkpoint(100),
    });
    await db.messages.put({
      id: "message-1",
      conversationId: conversation.id,
      role: "assistant",
      content: "continued",
      status: "complete",
      createdAt: 101,
    });
    expect(await findUnfinishedRuns()).toEqual([]);
  });

  it("clears a dismissed recovery checkpoint", async () => {
    await db.settings.put({
      name: `checkpoint:${conversation.id}`,
      value: checkpoint(),
    });
    await clearCheckpoint(conversation.id);
    expect(await db.settings.get(`checkpoint:${conversation.id}`)).toBeUndefined();
  });
});
