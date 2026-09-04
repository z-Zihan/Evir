/**
 * Canonical per-conversation run phase — the ONE runtime-state definition
 * every UI surface (sidebar rows, composer stop state, workspace badges,
 * header status) derives from.
 *
 * State machine (Core Simplification §19):
 *
 * ```text
 * idle → preparing → streaming → tool-running* → waiting-approval → streaming
 *      → verifying → completed
 *      → failed | stopped            (terminal, from any active phase)
 * waiting-user                       (paused on user input: clarification / paused plan)
 * ```
 *
 * *tool-running is represented inside the streaming slot: tool execution
 * happens between model requests within one run, and the tool UI subscribes
 * to workspace run events rather than a separate phase. The phases that the
 * sidebar/composer need to distinguish are the ones below.
 *
 * Source of truth mapping — nothing else may invent its own "is it running":
 * - preparing / streaming / verifying: chat-store `streamSlots[id].phase`
 * - waiting-approval: chat-store `pendingApprovals[id]`
 * - waiting-user: orchestration snapshot phase clarification|paused
 * - failed / stopped: chat-store `runOutcomes[id].status`
 * - unread: conversation.updatedAt vs conversationViewedAt (view concern)
 */
export type RunPhase =
  "preparing" | "streaming" | "verifying" | "approval" | "waiting-user" | "failed" | "stopped";

/** View-facing status = RunPhase + the unread view marker. */
export type ConversationRunStatus = RunPhase | "unread";

export interface RunPhaseFacts {
  slotPhase?: "preparing" | "streaming" | "verifying";
  hasPendingApproval: boolean;
  waitingUser: boolean;
  outcomeStatus?: "completed" | "failed" | "stopped";
}

/**
 * Priority ladder for resolving one conversation's live phase. Approval
 * waits outrank streaming (the run is parked); the slot outranks terminal
 * outcomes (a stopped tail may still be persisting); outcomes outrank
 * waiting-user; everything else is idle from the runtime's perspective.
 */
export function deriveRunPhase(facts: RunPhaseFacts): RunPhase | null {
  if (facts.hasPendingApproval) return "approval";
  if (facts.slotPhase) return facts.slotPhase;
  if (facts.outcomeStatus === "failed") return "failed";
  if (facts.outcomeStatus === "stopped") return "stopped";
  if (facts.waitingUser) return "waiting-user";
  return null;
}
