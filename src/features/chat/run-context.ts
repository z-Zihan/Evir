import type { PermissionContext } from "../../core/security/permission-profiles";
import type { AgentRunRecord } from "./agent-run-record";
import type { ConversationRecord, ProjectRecord } from "../../core/storage/db";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { grantedToolsForProject } from "../projects/tool-grants";
import { logger } from "../../core/logging/logger";

/**
 * Run-context binding (§17/§18 of the continuation contract): a run — and
 * every continuation of it (user resume after Stop, approval continuation,
 * orchestrated node, app-restart recovery) — resolves its permission context
 * from the CONVERSATION's persisted projectId, never from which project the
 * UI happens to have selected. Users switch pages, projects, profiles, and
 * restart the app mid-task; the thread's persisted binding is the fact.
 */
export interface RunBinding {
  conversationId: string;
  /** Persisted owner project; null for standalone (Ask) conversations. */
  projectId: string | null;
  /** The bound project's root (null when unbound or the project vanished). */
  root: string | null;
  /** Full run permission context including scoped grants (§37b). */
  permissionContext: PermissionContext | null;
}

/**
 * Resolve the durable run binding for a conversation. Storage-backed by
 * design: conversations/projects/grants are all persisted records, so the
 * answer is identical before and after an app restart. The live UI
 * resolver only remains as the caller's fallback for unbound conversations.
 */
export async function runBindingForConversation(conversationId: string): Promise<RunBinding> {
  const storage = getStructuredStorage();
  const conversation = await storage
    .read<ConversationRecord>("conversations", conversationId)
    .catch(() => undefined);
  const projectId = conversation?.projectId ?? null;
  if (!projectId) {
    return { conversationId, projectId: null, root: null, permissionContext: null };
  }
  const project = await storage.read<ProjectRecord>("projects", projectId).catch(() => undefined);
  if (!project) {
    // The conversation outlived its project (deleted project): no inherited
    // authority — callers fall back to the conservative legacy path.
    return { conversationId, projectId, root: null, permissionContext: null };
  }
  const grantedTools = await grantedToolsForProject(projectId);
  const permissionContext: PermissionContext = {
    profile: project.permissionProfile,
    roots: [project.canonicalRootPath, ...project.additionalAccessRoots],
    ...(grantedTools.size > 0 ? { grantedTools } : {}),
  };
  return {
    conversationId,
    projectId,
    root: project.rootPath,
    permissionContext,
  };
}

/**
 * §21 continuation trace: the newest persisted run of this conversation
 * BEFORE the current one. A run is a continuation when this is non-null —
 * the id is recorded so audits can chain resume rounds to their origin.
 */
export async function previousRunIdForConversation(conversationId: string): Promise<string | null> {
  const runs = await getStructuredStorage()
    .query<AgentRunRecord>("agent_runs", { conversationId })
    .catch(() => [] as AgentRunRecord[]);
  if (runs.length === 0) return null;
  runs.sort((a, b) => b.updatedAt - a.updatedAt);
  return runs[0]?.id ?? null;
}

/**
 * Emit the run-context audit line (§21): continuation linkage, project
 * binding, permission profile, and scoped-grant provenance. Never includes
 * secrets — grants are tool names, roots are paths the user configured.
 */
export async function logRunContext(args: {
  conversationId: string;
  runId: string;
  binding: RunBinding;
  source: "conversation-project" | "legacy-fallback";
}): Promise<void> {
  const continuationOfRunId = await previousRunIdForConversation(args.conversationId);
  logger.info("security", "run.context", {
    conversationId: args.conversationId,
    runId: args.runId,
    continuationOfRunId,
    projectId: args.binding.projectId,
    permissionProfile: args.binding.permissionContext?.profile ?? null,
    scopedGrantCount: args.binding.permissionContext?.grantedTools?.size ?? 0,
    scopedGrantSource: args.binding.permissionContext?.grantedTools?.size ? "project-store" : null,
    source: args.source,
  });
}
