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
 * Live mirror of the active (or most recent) run's changes and outputs.
 * Hydrated from the persisted AgentRunRecord when a conversation is opened,
 * then updated in real time from tool-execution events while the run is in
 * flight. On run completion the record (rebuilt through the same derive
 * functions) replaces the incremental state, keeping one source of truth.
 */

interface RunWorkspaceState {
  runId: string | null;
  conversationId: string | null;
  changes: ChangeEntry[];
  outputs: TaskOutput[];
  /** True while the run's most recent tool event was a browser action. */
  browserActive: boolean;
  hydrate: (record: AgentRunRecord) => void;
  clear: () => void;
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
    // A brand-new run resets the panel: the previous run's changes must not
    // accumulate into the next run's workspace view.
    const sameRun = state.runId === event.runId;
    const { changes, outputs } = applyEvent(
      sameRun ? state.changes : [],
      sameRun ? state.outputs : [],
      event,
    );
    set({
      runId: event.runId,
      conversationId: event.conversationId,
      changes,
      outputs,
      browserActive: event.toolCall.toolName.startsWith("browser_"),
    });
  });
  return {
    runId: null,
    conversationId: null,
    changes: [],
    outputs: [],
    browserActive: false,
    hydrate: (record) =>
      set({
        runId: record.id,
        conversationId: record.conversationId,
        changes: deriveChanges(record.toolCalls, record.toolResults, record.snapshots, record.id),
        outputs: deriveTaskOutputs(record.toolCalls, record.toolResults, record.snapshots, {
          runId: record.id,
          conversationId: record.conversationId,
        }),
      }),
    clear: () => set({ runId: null, conversationId: null, changes: [], outputs: [] }),
  };
});
