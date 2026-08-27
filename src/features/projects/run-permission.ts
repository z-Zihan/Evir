import type { PermissionContext } from "../../core/security/permission-profiles";
import { getActiveWorkspaceRoot } from "../../core/workspace/active-root";
import { useProjectStore } from "./project-store";

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

export function permissionContextForActiveRun(): PermissionContext | null {
  return permissionContextForRoot(getActiveWorkspaceRoot());
}
