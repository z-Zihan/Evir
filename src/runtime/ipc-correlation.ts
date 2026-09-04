/** Correlation threaded from the owning tool call when available; UI-direct
 * callers (file tree, preview) invoke without it.
 *
 * Lives in its own leaf module so the desktop adapter and the ipc retry store
 * can share the contract without importing each other (§circular-dependency
 * governance: no runtime↔runtime cycles, even type-only ones). */
export interface IpcCorrelation {
  conversationId?: string;
  runId?: string | null;
  toolCallId?: string;
}
