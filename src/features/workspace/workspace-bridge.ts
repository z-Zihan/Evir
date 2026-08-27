import { useMemo } from "react";
import { setRootResolver } from "../../core/workspace/active-root";
import { useProjectStore } from "../projects/project-store";

/**
 * Installs the app-shell workspace resolver: the current project's root wins;
 * the legacy global workspace stays as a migration fallback until the first
 * project exists.
 */
export function installWorkspaceResolver(): void {
  setRootResolver(() => {
    const project = useProjectStore.getState().currentProject();
    if (project) return project.rootPath;
    const { projects } = useProjectStore.getState();
    if (projects.length > 0) return null;
    const stored = globalThis.localStorage?.getItem("evir-workspace-current");
    return stored && stored.trim().length > 0 ? stored : null;
  });
}

/**
 * Reactive active workspace root for UI components: the selected project's
 * root, or the legacy global workspace until the first project exists.
 */
export function useActiveWorkspaceRoot(): string | null {
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  return useMemo(() => {
    const project = projects.find(({ id }) => id === currentProjectId);
    if (project) return project.rootPath;
    if (projects.length > 0) return null;
    const stored = globalThis.localStorage?.getItem("evir-workspace-current");
    return stored && stored.trim().length > 0 ? stored : null;
  }, [projects, currentProjectId]);
}
