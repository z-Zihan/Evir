import { getStructuredStorage } from "../../runtime/structured-storage";
import { logger } from "../../core/logging/logger";
import { useProjectStore } from "./project-store";

/**
 * Scoped tool approvals (§37b): "Allow this tool in this project" persists a
 * per-project, per-tool grant so later L2/L3 calls of the same tool inside
 * the project's granted roots skip the per-call prompt. The grant NEVER
 * relaxes path boundaries (outside-root paths still ask) and never covers L4.
 * Switching the project's permission profile clears its grants — changing
 * the policy means re-asking.
 */
const GRANT_SETTING_NAME = "permission_tool_grants";

/** projectId → toolName → ISO timestamp of the user's grant. */
type ToolGrantMap = Record<string, Record<string, string>>;

function isGrantMap(value: unknown): value is ToolGrantMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const tools of Object.values(value as Record<string, unknown>)) {
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) return false;
    for (const grantedAt of Object.values(tools as Record<string, unknown>)) {
      if (typeof grantedAt !== "string") return false;
    }
  }
  return true;
}

async function readGrantMap(): Promise<ToolGrantMap> {
  const record = await getStructuredStorage()
    .read<{ name: string; value: unknown }>("settings", GRANT_SETTING_NAME)
    .catch(() => undefined);
  const value = record?.value;
  return isGrantMap(value) ? value : {};
}

async function writeGrantMap(map: ToolGrantMap): Promise<void> {
  await getStructuredStorage()
    .write("settings", GRANT_SETTING_NAME, { name: GRANT_SETTING_NAME, value: map })
    .catch(() => undefined);
}

function comparable(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

/** The project a workspace root belongs to (same matching as run-permission). */
function projectForRoot(root: string | null | undefined) {
  if (!root) return null;
  return (
    useProjectStore
      .getState()
      .projects.find(
        (candidate) =>
          comparable(candidate.rootPath) === comparable(root) ||
          comparable(candidate.canonicalRootPath) === comparable(root),
      ) ?? null
  );
}

export async function grantedToolsForRoot(root: string | null | undefined): Promise<Set<string>> {
  const project = projectForRoot(root);
  if (!project) return new Set<string>();
  const map = await readGrantMap();
  return new Set(Object.keys(map[project.id] ?? {}));
}

export async function grantToolInProject(
  root: string | null | undefined,
  toolName: string,
): Promise<string | null> {
  const project = projectForRoot(root);
  if (!project) {
    // No project binding (legacy workspace chat): the scoped option must not
    // degrade into a global always-allow, so nothing is persisted.
    logger.warn("security", "permission.tool-grant-unavailable", { toolName });
    return null;
  }
  const map = await readGrantMap();
  const next: ToolGrantMap = {
    ...map,
    [project.id]: { ...(map[project.id] ?? {}), [toolName]: new Date().toISOString() },
  };
  await writeGrantMap(next);
  logger.info("security", "permission.tool-granted", { projectId: project.id, toolName });
  return project.id;
}

/** Called when the project's permission profile changes: grants are void. */
export async function clearToolGrants(projectId: string): Promise<void> {
  const map = await readGrantMap();
  if (!(projectId in map)) return;
  const next = { ...map };
  delete next[projectId];
  await writeGrantMap(next);
  logger.info("security", "permission.tool-grants-cleared", { projectId });
}
