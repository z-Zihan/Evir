import { create } from "zustand";
import type { OrchestrationSnapshot } from "../../core/orchestration/types";

export interface TaskPreparationState {
  conversationId: string;
  objective: string;
  stage: "intake" | "planning";
  startedAt: number;
}

/**
 * Orchestration snapshots are keyed by conversation: concurrent tasks each
 * keep their own DAG state. The flat `current` / `preparing` fields are VIEW
 * mirrors of the conversation on screen (what TaskWorkbench renders). Before
 * any conversation has been viewed (fresh start), each mirror falls back to
 * the conversation of its own most recent write so standalone flows keep
 * working without a view selection.
 */
interface OrchestrationState {
  current: OrchestrationSnapshot | null;
  preparing: TaskPreparationState | null;
  byConversation: Record<string, OrchestrationSnapshot>;
  preparingByConversation: Record<string, TaskPreparationState>;
  currentFallbackId: string | null;
  preparingFallbackId: string | null;
  viewedConversationId: string | null;
  /** Non-reactive accessor used by orchestration flows for ONE conversation. */
  snapshotFor: (conversationId: string | null | undefined) => OrchestrationSnapshot | null;
  setCurrent: (snapshot: OrchestrationSnapshot | null) => void;
  setPreparing: (preparing: TaskPreparationState | null) => void;
  setPreparationStage: (conversationId: string, stage: TaskPreparationState["stage"]) => void;
  /** Repoints the view mirrors when the user switches conversations. */
  setViewedConversation: (conversationId: string | null) => void;
  /** Drops one conversation's snapshot entirely (e.g. conversation deleted). */
  discardConversation: (conversationId: string) => void;
}

function mirrorCurrent(
  state: Pick<OrchestrationState, "viewedConversationId" | "currentFallbackId" | "byConversation">,
): OrchestrationSnapshot | null {
  const target = state.viewedConversationId ?? state.currentFallbackId;
  return target ? (state.byConversation[target] ?? null) : null;
}

function mirrorPreparing(
  state: Pick<
    OrchestrationState,
    "viewedConversationId" | "preparingFallbackId" | "preparingByConversation"
  >,
): TaskPreparationState | null {
  const target = state.viewedConversationId ?? state.preparingFallbackId;
  return target ? (state.preparingByConversation[target] ?? null) : null;
}

export const useOrchestrationStore = create<OrchestrationState>((set, get) => ({
  current: null,
  preparing: null,
  byConversation: {},
  preparingByConversation: {},
  currentFallbackId: null,
  preparingFallbackId: null,
  viewedConversationId: null,
  snapshotFor: (conversationId) => {
    if (!conversationId) return null;
    const state = get();
    const mapped = state.byConversation[conversationId];
    if (mapped) return mapped;
    // Compatibility: flat seeding (tests, legacy direct writes) still resolves
    // when the view mirror belongs to the requested conversation.
    return state.current?.conversationId === conversationId ? state.current : null;
  },
  setCurrent: (snapshot) =>
    set((state) => {
      const byConversation = { ...state.byConversation };
      if (snapshot) {
        byConversation[snapshot.conversationId] = snapshot;
      } else {
        const target = state.viewedConversationId ?? state.currentFallbackId;
        if (target) delete byConversation[target];
      }
      const next = {
        ...state,
        byConversation,
        currentFallbackId: snapshot ? snapshot.conversationId : state.currentFallbackId,
      };
      return {
        byConversation,
        currentFallbackId: next.currentFallbackId,
        current: mirrorCurrent(next),
        preparing: mirrorPreparing(next),
      };
    }),
  setPreparing: (preparing) =>
    set((state) => {
      const preparingByConversation = { ...state.preparingByConversation };
      if (preparing) {
        preparingByConversation[preparing.conversationId] = preparing;
      } else {
        const target = state.viewedConversationId ?? state.preparingFallbackId;
        if (target) delete preparingByConversation[target];
      }
      const next = {
        ...state,
        preparingByConversation,
        preparingFallbackId: preparing ? preparing.conversationId : state.preparingFallbackId,
      };
      return {
        preparingByConversation,
        preparingFallbackId: next.preparingFallbackId,
        preparing: mirrorPreparing(next),
      };
    }),
  setPreparationStage: (conversationId, stage) =>
    set(({ preparingByConversation }) => {
      const existing = preparingByConversation[conversationId];
      return existing
        ? {
            preparingByConversation: {
              ...preparingByConversation,
              [conversationId]: { ...existing, stage },
            },
          }
        : {};
    }),
  setViewedConversation: (conversationId) =>
    set((state) => {
      const next = { ...state, viewedConversationId: conversationId };
      return {
        viewedConversationId: conversationId,
        current: mirrorCurrent(next),
        preparing: mirrorPreparing(next),
      };
    }),
  discardConversation: (conversationId) =>
    set((state) => {
      const byConversation = { ...state.byConversation };
      delete byConversation[conversationId];
      const preparingByConversation = { ...state.preparingByConversation };
      delete preparingByConversation[conversationId];
      const next = {
        ...state,
        byConversation,
        preparingByConversation,
        currentFallbackId:
          state.currentFallbackId === conversationId ? null : state.currentFallbackId,
        preparingFallbackId:
          state.preparingFallbackId === conversationId ? null : state.preparingFallbackId,
      };
      return {
        byConversation,
        preparingByConversation,
        currentFallbackId: next.currentFallbackId,
        preparingFallbackId: next.preparingFallbackId,
        current: mirrorCurrent(next),
        preparing: mirrorPreparing(next),
      };
    }),
}));
