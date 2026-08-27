import type { ConversationRecord } from "../../core/storage/db";
import type { InteractionMode } from "../../core/providers/tool-registry";
import { useProjectStore } from "./project-store";

const LEGACY_WORKSPACE_KEY = "evir-workspace-current";

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
