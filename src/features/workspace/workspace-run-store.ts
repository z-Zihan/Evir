import { create } from "zustand";
import type { AgentRunRecord } from "../chat/agent-run-record";
import { deriveChanges, type ChangeEntry } from "./changes-model";
import {
  deriveTaskOutput,
  deriveTaskOutputs,
  mergeTaskOutputs,
  type TaskOutput,
} from "./task-output-model";
import { subscribeWorkspaceToolEvents, type WorkspaceToolEvent } from "./workspace-events";

/**
 * Live mirror of each conversation's active (or most recent) run — changes and
 * outputs keyed by conversationId so concurrent tasks never bleed into each
 * other. Hydrated from the persisted AgentRunRecord when a conversation is
 * opened, then updated in real time from tool-execution events while the run
 * is in flight. On run completion the record (rebuilt through the same derive
 * functions) replaces the incremental state, keeping one source of truth.
 *
 * The flat fields (runId / changes / outputs / browserActive) are VIEW mirrors
 * of the conversation currently on screen.
 */

interface RunWorkspaceEntry {
  runId: string | null;
  changes: ChangeEntry[];
  outputs: TaskOutput[];
  /** True while the run's most recent tool event was a browser action. */
  browserActive: boolean;
}

interface RunWorkspaceState extends RunWorkspaceEntry {
  conversationId: string | null;
  viewedConversationId: string | null;
  entries: Record<string, RunWorkspaceEntry>;
  setViewedConversation: (conversationId: string | null) => void;
  hydrate: (record: AgentRunRecord) => void;
  clear: () => void;
}

const EMPTY_ENTRY: RunWorkspaceEntry = {
  runId: null,
  changes: [],
  outputs: [],
  browserActive: false,
};

function entryView(
  entries: Record<string, RunWorkspaceEntry>,
  conversationId: string | null,
): RunWorkspaceEntry & { conversationId: string | null } {
  const entry = conversationId ? (entries[conversationId] ?? EMPTY_ENTRY) : EMPTY_ENTRY;
  return { ...entry, conversationId };
}

function applyEvent(
  changes: readonly ChangeEntry[],
  outputs: readonly TaskOutput[],
  event: WorkspaceToolEvent,
): { changes: ChangeEntry[]; outputs: TaskOutput[] } {
  const runId = event.runId;
  if (!runId) return { changes: [...changes], outputs: [...outputs] };
  const single = deriveChanges([event.toolCall], [event.result], event.newSnapshots, runId);
  const merged = [...changes];
  for (const entry of single) {
    const index = merged.findIndex((existing) => existing.path === entry.path);
    if (index === -1) {
      merged.push(entry);
    } else {
      const existing = merged[index]!;
      // A file the run created stays "added" across follow-up edits.
      merged[index] = existing.changeType === "added" ? { ...entry, changeType: "added" } : entry;
    }
  }
  const output = deriveTaskOutput(event.toolCall, event.result, {
    runId,
    conversationId: event.conversationId,
    newSnapshots: event.newSnapshots,
  });
  return {
    changes: merged.sort((a, b) => a.createdAt - b.createdAt),
    outputs: output ? mergeTaskOutputs(outputs, [output]) : [...outputs],
  };
}

export const useRunWorkspaceStore = create<RunWorkspaceState>((set, get) => {
  subscribeWorkspaceToolEvents((event) => {
    if (!event.runId) return;
    const state = get();
    const existing = state.entries[event.conversationId] ?? EMPTY_ENTRY;
    // A brand-new run resets that conversation's entry: the previous run's
    // changes must not accumulate into the next run's workspace view.
    const sameRun = existing.runId === event.runId;
    const { changes, outputs } = applyEvent(
      sameRun ? existing.changes : [],
      sameRun ? existing.outputs : [],
      event,
    );
    const entry: RunWorkspaceEntry = {
      runId: event.runId,
      changes,
      outputs,
      browserActive: event.toolCall.toolName.startsWith("browser_"),
    };
    set((current) => {
      const entries = {
        ...current.entries,
        [event.conversationId]: entry,
      };
      // Flat fields mirror the viewed conversation; before any conversation
      // has been viewed (fresh start), fall back to the event's own.
      const targetView = current.viewedConversationId ?? event.conversationId;
      return {
        entries,
        ...(targetView === event.conversationId
          ? { ...entry, conversationId: event.conversationId }
          : {}),
      };
    });
  });
  return {
    runId: null,
    conversationId: null,
    changes: [],
    outputs: [],
    browserActive: false,
    viewedConversationId: null,
    entries: {},
    setViewedConversation: (conversationId) =>
      set((state) => ({
        viewedConversationId: conversationId,
        ...entryView(state.entries, conversationId),
      })),
    hydrate: (record) =>
      set((state) => {
        const entry: RunWorkspaceEntry = {
          runId: record.id,
          changes: deriveChanges(record.toolCalls, record.toolResults, record.snapshots, record.id),
          outputs: deriveTaskOutputs(record.toolCalls, record.toolResults, record.snapshots, {
            runId: record.id,
            conversationId: record.conversationId,
          }),
          browserActive: false,
        };
        const entries = {
          ...state.entries,
          [record.conversationId]: entry,
        };
        return {
          entries,
          ...((state.viewedConversationId ?? record.conversationId) === record.conversationId
            ? { ...entry, conversationId: record.conversationId }
            : {}),
        };
      }),
    clear: () =>
      set((state) => {
        const viewed = state.viewedConversationId;
        if (!viewed) return {};
        const entries = { ...state.entries };
        delete entries[viewed];
        return { entries, ...entryView(entries, viewed) };
      }),
  };
});
