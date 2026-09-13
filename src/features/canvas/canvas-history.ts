import type { EvirCanvasDocument } from "./canvas-document";

/**
 * Canvas undo/redo history (CAN-1). Snapshots are WHOLE validated documents,
 * so undo can never produce an illegal file — every state on either stack
 * already passed the document schema. The stack tracks USER edits; agent
 * rewrites land as checkpoints (a boundary the user can undo back to, never
 * through into a torn state, because snapshots are atomic).
 *
 * Bounds: at most MAX_STATES document snapshots; pushing after a undo trims
 * the redo branch (standard linear history semantics).
 */

const MAX_STATES = 50;

interface HistoryEntry {
  document: EvirCanvasDocument;
  /** True when this state was written by an agent tool, not the user. */
  agent: boolean;
}

export interface CanvasHistory {
  /** Record a user edit (post-autosave document). */
  pushUserState(document: EvirCanvasDocument): void;
  /** Record an agent rewrite (update_canvas / create_canvas). */
  agentCheckpoint(document: EvirCanvasDocument): void;
  /** Drop all history and seed with the current document (initial load). */
  reset(document: EvirCanvasDocument): void;
  undo(): EvirCanvasDocument | null;
  redo(): EvirCanvasDocument | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createCanvasHistory(initial: EvirCanvasDocument): CanvasHistory {
  let past: HistoryEntry[] = [];
  let present: HistoryEntry = { document: initial, agent: false };
  let future: HistoryEntry[] = [];

  const commit = (entry: HistoryEntry) => {
    past.push(present);
    if (past.length > MAX_STATES) past = past.slice(past.length - MAX_STATES);
    present = entry;
    future = [];
  };

  return {
    pushUserState(document) {
      commit({ document, agent: false });
    },
    agentCheckpoint(document) {
      commit({ document, agent: true });
    },
    reset(document) {
      past = [];
      present = { document, agent: false };
      future = [];
    },
    undo() {
      const previous = past.pop();
      if (!previous) return null;
      future.push(present);
      present = previous;
      return previous.document;
    },
    redo() {
      const next = future.pop();
      if (!next) return null;
      past.push(present);
      present = next;
      return next.document;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
