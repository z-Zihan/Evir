import type { PermissionContext } from "../../core/security/permission-profiles";
import { getActiveWorkspaceRoot } from "../../core/workspace/active-root";
import { useProjectStore } from "./project-store";
import { grantedToolsForRoot } from "./tool-grants";

function comparable(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * Derives the permission context for a run from its bound workspace root, so
 * approval continuations and fresh runs resolve identical policy even after
 * the user switched projects in between. Legacy-workspace runs (no project)
 * use the conservative "ask" profile scoped to that root.
 */
export function permissionContextForRoot(
  root: string | null | undefined,
): PermissionContext | null {
  if (!root) return null;
  const project = useProjectStore
    .getState()
    .projects.find(
      (candidate) =>
        comparable(candidate.rootPath) === comparable(root) ||
        comparable(candidate.canonicalRootPath) === comparable(root),
    );
  if (!project) return { profile: "ask", roots: [root] };
  return {
    profile: project.permissionProfile,
    roots: [project.canonicalRootPath, ...project.additionalAccessRoots],
  };
}

/**
 * Run-start context: the base profile plus this project's scoped tool grants
 * (§37b), so granted tools skip the per-call prompt from the first call on.
 */
export async function permissionContextForRunWithGrants(
  root: string | null | undefined,
): Promise<PermissionContext | null> {
  const context = permissionContextForRoot(root);
  if (!context) return null;
  const grantedTools = await grantedToolsForRoot(root);
  return grantedTools.size > 0 ? { ...context, grantedTools } : context;
}

export function permissionContextForActiveRun(): PermissionContext | null {
  return permissionContextForRoot(getActiveWorkspaceRoot());
}
