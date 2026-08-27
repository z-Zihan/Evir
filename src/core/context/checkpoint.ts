import type { MessageRecord, SettingRecord } from "../storage/db";
import { z } from "zod";
import { estimateMessagesTokens } from "./token-estimate";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { buildRunCapsule } from "./run-capsule";

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
  userConstraints: string[];
  approvals: string[];
  changedArtifacts: string[];
  verificationEvidence: string[];
  relevantMemoryIds: string[];
  contextSummaryVersion: string;
  mode: "ask" | "plan" | "goal" | "agent";
}

export interface CheckpointOptions {
  mode?: Checkpoint["mode"];
  relevantMemoryIds?: string[];
}

const checkpointSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
  summary: z.string(),
  objective: z.string(),
  completedSteps: z.array(z.string()).default([]),
  pendingSteps: z.array(z.string()).default([]),
  unresolvedErrors: z.array(z.string()).default([]),
  userConstraints: z.array(z.string()).default([]),
  approvals: z.array(z.string()).default([]),
  changedArtifacts: z.array(z.string()).default([]),
  verificationEvidence: z.array(z.string()).default([]),
  relevantMemoryIds: z.array(z.string()).default([]),
  contextSummaryVersion: z.string().default("legacy"),
  mode: z.enum(["ask", "plan", "agent"]).default("agent"),
});

export function normalizeCheckpoint(value: unknown): Checkpoint | null {
  const parsed = checkpointSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Create a checkpoint when context utilization exceeds 90%.
 * Saves a snapshot of the conversation state to allow recovery.
 */
export async function createCheckpoint(
  conversationId: string,
  messages: MessageRecord[],
  objective: string,
  options: CheckpointOptions = {},
): Promise<Checkpoint> {
  const now = Date.now();
  const tokenEstimate = estimateMessagesTokens(messages);

  const capsule = buildRunCapsule(messages);
  const completedSteps = new Set<string>();
  const pendingSteps: string[] = [];
  const completedToolCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.toolResults) {
      for (const result of msg.toolResults) {
        completedToolCallIds.add(result.toolCallId);
        if (result.success) {
          completedSteps.add(`${result.toolName}: ${result.output.slice(0, 100)}`);
        }
      }
    }
  }
  for (const msg of messages) {
    for (const call of msg.toolCalls ?? []) {
      if (!completedToolCallIds.has(call.id)) pendingSteps.push(`Awaiting ${call.toolName}`);
    }
  }

  const checkpoint: Checkpoint = {
    id: `cp-${now}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    createdAt: now,
    messageCount: messages.length,
    tokenEstimate,
    summary: `Checkpoint at ${new Date(now).toISOString()}: ${messages.length} messages, ~${tokenEstimate} tokens`,
    objective: objective || capsule.objective,
    completedSteps: [...completedSteps],
    pendingSteps,
    unresolvedErrors: capsule.errors,
    userConstraints: capsule.userConstraints,
    approvals: capsule.pendingApprovals,
    changedArtifacts: capsule.fileChanges,
    verificationEvidence: capsule.lastVerificationEvidence,
    relevantMemoryIds: [...new Set(options.relevantMemoryIds ?? [])],
    contextSummaryVersion: "1",
    mode: options.mode ?? "agent",
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
  return normalizeCheckpoint(record?.value);
}

/**
 * Build a handoff message for model switching.
 * Creates a system message that preserves context across model changes.
 */
export function buildHandoffMessage(
  checkpoint: Checkpoint,
  newModelId: string,
): { role: "system"; content: string } {
  const parts: string[] = [
    `[Model Handoff → ${newModelId}]`,
    `Mode: ${checkpoint.mode}`,
    `Objective: ${checkpoint.objective}`,
  ];

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

  if (checkpoint.userConstraints.length > 0) {
    parts.push("User constraints:");
    checkpoint.userConstraints.forEach((constraint) => parts.push(`  - ${constraint}`));
  }
  if (checkpoint.approvals.length > 0) {
    parts.push("Pending approvals:");
    checkpoint.approvals.forEach((approval) => parts.push(`  - ${approval}`));
  }
  if (checkpoint.changedArtifacts.length > 0) {
    parts.push("Changed artifacts:");
    checkpoint.changedArtifacts.forEach((artifact) => parts.push(`  - ${artifact}`));
  }
  if (checkpoint.verificationEvidence.length > 0) {
    parts.push("Verification evidence:");
    checkpoint.verificationEvidence.forEach((evidence) => parts.push(`  - ${evidence}`));
  }
  if (checkpoint.relevantMemoryIds.length > 0) {
    parts.push(`Relevant local memory references: ${checkpoint.relevantMemoryIds.join(", ")}`);
  }

  parts.push(
    `Previous context: ${checkpoint.messageCount} messages (~${checkpoint.tokenEstimate} tokens)`,
  );

  return {
    role: "system",
    content: parts.join("\n"),
  };
}
