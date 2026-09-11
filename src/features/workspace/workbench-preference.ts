import { readProfileScoped, writeProfileScoped } from "../../core/profile/profile-scope";

/**
 * Per-project "user closed the workbench" preference (§30b): a project
 * thread opens with the workbench (Changes tab) by default, but once the
 * user explicitly closes it for a project, that choice sticks — later
 * threads in the project start closed until the user reopens it.
 * Profile-scoped localStorage, mirroring CURRENT_PROJECT_KEY's pattern.
 */
const CLOSED_PROJECTS_KEY = "evir-workbench-closed-projects";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function readClosedWorkbenchProjects(): Set<string> {
  return new Set(parseIds(readProfileScoped(CLOSED_PROJECTS_KEY)));
}

export function markWorkbenchClosedForProject(projectId: string): void {
  const next = new Set(readClosedWorkbenchProjects());
  next.add(projectId);
  writeProfileScoped(CLOSED_PROJECTS_KEY, JSON.stringify([...next]));
}

export function markWorkbenchReopenedForProject(projectId: string): void {
  const next = new Set(readClosedWorkbenchProjects());
  if (!next.delete(projectId)) return;
  writeProfileScoped(CLOSED_PROJECTS_KEY, JSON.stringify([...next]));
}
