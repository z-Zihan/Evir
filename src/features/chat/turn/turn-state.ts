import type { StoreApi } from "zustand";
import type { ConversationRecord, MessageRecord, ProviderRecord } from "../../../core/storage/db";
import type { ChatState } from "../chat-contracts";
import type { EvirRuntime } from "../../../runtime/types";

export type ChatStoreSet = StoreApi<ChatState>["setState"];
export type ChatStoreGet = StoreApi<ChatState>["getState"];

/**
 * Everything one assistant turn shares across its lifecycle phases
 * (prepare → execute → verify → persist). Built once by the stream-response
 * orchestrator; each phase reads from it instead of re-deriving state.
 */
export interface TurnContext {
  set: ChatStoreSet;
  get: ChatStoreGet;
  /** Full in-store history at send time (before any compaction). */
  history: MessageRecord[];
  conversationId: string;
  runtime: EvirRuntime;
  provider: ProviderRecord;
  /** Timestamp returned by beginConversationStream; ownership token for the slot. */
  streamStartedAt: number;
  /** User message this turn responds to (from history). */
  lastUserMessage: MessageRecord | undefined;
  conversation: ConversationRecord | undefined;
  /** Skill ids the user explicitly attached to this send. */
  explicitlySelectedSkillIds: ReadonlySet<string>;
}

/** Prepared turn handed from prepareTurn to executeTurn. */
export interface PreparedTurn {
  /** Effective mode after middleware + capability gates. */
  mode: ChatState["mode"];
  /** Middleware-normalized user input (replaces the last user message content). */
  normalizedUserInput: string;
  /** History after budget compaction and input normalization. */
  effectiveHistory: MessageRecord[];
  /** Provider wire messages including the system prompt at index 0. */
  messages: { role: string; content: unknown }[];
}
