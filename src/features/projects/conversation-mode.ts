import type { ConversationRecord } from "../../core/storage/db";
import type { InteractionMode } from "../../core/providers/tool-registry";
import { useProjectStore } from "./project-store";
import { CURRENT_STORAGE_KEY as LEGACY_WORKSPACE_KEY } from "../workspace/workspace-store";

export function conversationProjectId(conversation: ConversationRecord | undefined): string | null {
  return conversation?.projectId ?? null;
}

function legacyWorkspacePresent(): boolean {
  const stored = globalThis.localStorage?.getItem(LEGACY_WORKSPACE_KEY);
  return stored !== null && stored !== undefined && stored.trim().length > 0;
}

/**
 * Whether project-scoped modes (agent/plan/goal) may run for this
 * conversation. Project threads always qualify. Standalone conversations only
 * keep the legacy global-workspace behavior until the first project exists —
 * after that, standalone chats are ask-only.
 */
export function allowsProjectModes(conversation: ConversationRecord | undefined): boolean {
  if (conversationProjectId(conversation) !== null) return true;
  if (useProjectStore.getState().projects.length > 0) return false;
  return legacyWorkspacePresent();
}

export function effectiveMode(
  conversation: ConversationRecord | undefined,
  requestedMode: InteractionMode,
): InteractionMode {
  if (!allowsProjectModes(conversation)) return "ask";
  return requestedMode;
}

/**
 * A project task uses Agent semantics when the model can call tools. With a
 * text-only model, the same task remains usable as chat instead of failing
 * every send. The UI hides Plan/Goal in that state; a stale special-mode value
 * (for example after restoring a session) is safely treated as chat-only.
 */
export function effectiveModeForModel(
  conversation: ConversationRecord | undefined,
  requestedMode: InteractionMode,
  toolCalling: boolean,
): InteractionMode {
  const mode = effectiveMode(conversation, requestedMode);
  return mode !== "ask" && !toolCalling ? "ask" : mode;
}
