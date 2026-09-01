import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import type { SnapshotResult } from "../../runtime/desktop-storage-adapter";

/**
 * In-process tool-execution events. The agent loop runs in the same JS
 * context as the UI, so a lightweight synchronous bus is enough to drive the
 * real-time Changes/Files/Outputs panels — no IPC round trips.
 */

export interface WorkspaceToolEvent {
  conversationId: string;
  runId: string | null;
  toolCall: ToolCallRecord;
  result: ToolResultRecord;
  /** Snapshots recorded by this specific call (before → after diff). */
  newSnapshots: readonly SnapshotResult[];
}

type Listener = (event: WorkspaceToolEvent) => void;

const listeners = new Set<Listener>();

export function emitWorkspaceToolEvent(event: WorkspaceToolEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A broken panel subscription must never break the agent loop.
    }
  }
}

export function subscribeWorkspaceToolEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
