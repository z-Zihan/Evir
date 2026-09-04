import type { ConversationRecord, MessageRecord } from "../../../core/storage/db";
import { getStructuredStorage } from "../../../runtime/structured-storage";
import { logger } from "../../../core/logging/logger";
import { toApprovalRecord, type PendingToolApproval } from "../tool-approval";
import { toMessage, sorted } from "../chat-helpers";
import type { StreamResult } from "../chat-stream";
import { activeTraceFor } from "../../tracing/trace-recorder";
import {
  ownsConversationSlot,
  setPendingApproval,
  visibleForConversation,
} from "../stream-ownership";
import { buildAgentRunRecord, persistAgentRun, type AgentRunRecord } from "../agent-run-record";
import type { AgentLoopResult } from "../agent-loop";
import type { TurnContext } from "./turn-state";

export function titleFor(history: MessageRecord[], hasTitle: boolean): string | undefined {
  const firstMessage = history.length === 1 ? history[0] : undefined;
  return !hasTitle && firstMessage?.role === "user" ? firstMessage.content.slice(0, 60) : undefined;
}

export async function persistResponse(
  messages: MessageRecord[],
  conversationId: string,
  title?: string,
): Promise<number> {
  const updatedAt = Date.now();
  const storage = getStructuredStorage();
  const conversation = await storage.read<ConversationRecord>("conversations", conversationId);
  await storage.apply([
    ...messages.map((message) => ({
      type: "write" as const,
      entity: "messages" as const,
      id: message.id,
      data: message,
    })),
    ...(conversation
      ? [
          {
            type: "write" as const,
            entity: "conversations" as const,
            id: conversationId,
            data: { ...conversation, updatedAt, ...(title ? { title } : {}) },
          },
        ]
      : []),
  ]);
  return updatedAt;
}

export interface ApprovalContext {
  runId: string;
  nodeId: string;
  mode: "agent" | "goal" | "plan" | "ask";
  allowedToolIds: string[];
  messages: { role: string; content: unknown }[];
  turn: AgentLoopResult["turns"][number];
  agentRun: AgentLoopResult["agentRun"];
}

/**
 * persistApprovalWait — the turn is parked on a pending approval. Persists the
 * turns that completed before the block, records the approval entities, hands
 * the wait to the approval store, and leaves the trace open for the resume.
 */
export async function persistApprovalWait(
  turn: TurnContext,
  args: {
    result: AgentLoopResult;
    pendingApprovals: PendingToolApproval[];
    approvalContexts: ApprovalContext[];
  },
): Promise<void> {
  const { set, get, conversationId, history } = turn;
  const { result, pendingApprovals, approvalContexts } = args;
  logger.info("approval", "approval.requested", {
    conversationId,
    count: pendingApprovals.length,
    tools: pendingApprovals.map(({ toolName, riskLevel }) => ({ toolName, riskLevel })),
  });
  const activeTrace = activeTraceFor(conversationId);
  for (const pending of pendingApprovals) {
    activeTrace?.approvalRequested(pending.toolCallId, pending.toolName);
  }
  const blockedTurns = new Set(approvalContexts.map(({ turn }) => turn));
  const earlierTurns = result.turns.filter((turn) => !blockedTurns.has(turn));
  const messageTimestamp = Date.now();
  const earlierMessages = earlierTurns.map((turn, index) =>
    toMessage(turn, conversationId, undefined, messageTimestamp + index),
  );
  if (earlierMessages.length > 0) {
    const conversation = get().conversations.find(({ id }) => id === conversationId);
    const title = titleFor(history, Boolean(conversation?.title));
    if (!get().privateSession) await persistResponse(earlierMessages, conversationId, title);
  }

  const blockedMessages = approvalContexts.map(({ turn }, index) =>
    toMessage(turn, conversationId, undefined, messageTimestamp + earlierMessages.length + index),
  );
  // The turn stays open across the approval wait; bind what exists so far so
  // 运行详情 is reachable from these rows while the approval is pending.
  activeTrace?.attachMessages([
    ...earlierMessages.map(({ id }) => id),
    ...blockedMessages.map(({ id }) => id),
  ]);
  void activeTrace?.flush();
  const [pendingApproval, ...remainingApprovals] = pendingApprovals;
  if (!pendingApproval) return;
  if (!get().privateSession) {
    await getStructuredStorage().writeMany(
      "approvals",
      pendingApprovals.map((pending) => toApprovalRecord(pending)),
    );
  }
  const agentRunRecord = await buildAgentRunRecord(result, conversationId, turn.runtime, {
    previous: await previousRunFor(turn, result),
  });
  if (!get().privateSession) await persistAgentRun(agentRunRecord);

  set(({ conversations, currentConversationId, messages: currentMessages }) => ({
    conversations: sorted(
      conversations.map((item) =>
        item.id === conversationId ? { ...item, updatedAt: Date.now() } : item,
      ),
    ),
    ...(currentConversationId === conversationId
      ? { messages: [...currentMessages, ...earlierMessages, ...blockedMessages] }
      : {}),
  }));
  // The approval belongs to THIS conversation whether or not it is on
  // screen: concurrent tasks can each wait on their own approval.
  setPendingApproval(set, get, conversationId, { ...pendingApproval, remainingApprovals });
  if (visibleForConversation(get, conversationId)) {
    set({ latestAgentRun: agentRunRecord });
  }
}

async function previousRunFor(
  turn: TurnContext,
  result: AgentLoopResult,
): Promise<AgentRunRecord | null> {
  const { get } = turn;
  if (get().latestAgentRun?.id === result.agentRun.id) return get().latestAgentRun;
  if (get().privateSession) return null;
  return (
    (await getStructuredStorage().read<AgentRunRecord>("agent_runs", result.agentRun.id)) ?? null
  );
}

/**
 * finalizeCompletedTurn — terminal bookkeeping after messages are persisted
 * and verification ran: run outcome recording and the final store sync
 * guarded by stream-slot ownership.
 */
export function finalizeCompletedTurn(
  turn: TurnContext,
  args: {
    assistants: MessageRecord[];
    title: string | undefined;
    updatedAt: number;
    error: string | null;
    agentRunRecord: AgentRunRecord | null;
    /** Stream status of the final turn; "stopped" is recorded as a stop. */
    lastStreamStatus: StreamResult["status"] | undefined;
  },
): void {
  const { set, get, conversationId, streamStartedAt } = turn;
  const { assistants, title, updatedAt, error, agentRunRecord, lastStreamStatus } = args;

  // Sidebar status bookkeeping: background runs record their settled outcome
  // even when the conversation is not on screen.
  const stoppedMidRun = lastStreamStatus === "stopped";
  const failed = Boolean(error) || agentRunRecord?.status === "failed";
  set((state) => ({
    runOutcomes: {
      ...state.runOutcomes,
      [conversationId]: {
        status: stoppedMidRun ? "stopped" : failed ? "failed" : "completed",
        at: Date.now(),
      },
    },
  }));

  // After a Stop the conversation's slot is gone and this tail must still land
  // (persisting the partial content); but if a NEWER run already owns the same
  // conversation, applying this tail would append stale turns on top of it.
  const ownsStreamSlot = ownsConversationSlot(get, conversationId, streamStartedAt);
  set(({ conversations, currentConversationId, messages: currentMessages }) => ({
    conversations: sorted(
      conversations.map((item) =>
        item.id === conversationId ? { ...item, updatedAt, ...(title ? { title } : {}) } : item,
      ),
    ),
    ...(ownsStreamSlot && currentConversationId === conversationId
      ? { messages: [...currentMessages, ...assistants] }
      : {}),
    ...(ownsStreamSlot && currentConversationId === conversationId
      ? {
          streamingContent: "",
          error: error ?? null,
          latestAgentRun: agentRunRecord,
        }
      : {}),
  }));
}
