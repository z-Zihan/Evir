import { getStructuredStorage } from "../../runtime/structured-storage";
import { logger } from "../../core/logging/logger";

/**
 * Scoped tool approvals (§37b): "Allow this tool in this project" persists a
 * per-project, per-tool grant so later L2/L3 calls of the same tool inside
 * the project's granted roots skip the per-call prompt. The grant NEVER
 * relaxes path boundaries (outside-root paths still ask) and never covers L4.
 * Switching the project's permission profile clears its grants — changing
 * the policy means re-asking.
 *
 * Pure storage keyed by projectId: root-to-project resolution lives in
 * run-permission.ts (which owns the project lookup), so this module holds no
 * dependency on the project store (import-cycle gate, §32-38).
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

export async function grantedToolsForProject(projectId: string): Promise<Set<string>> {
  const map = await readGrantMap();
  return new Set(Object.keys(map[projectId] ?? {}));
}

export async function grantToolForProject(projectId: string, toolName: string): Promise<string> {
  const map = await readGrantMap();
  const next: ToolGrantMap = {
    ...map,
    [projectId]: { ...(map[projectId] ?? {}), [toolName]: new Date().toISOString() },
  };
  await writeGrantMap(next);
  logger.info("security", "permission.tool-granted", { projectId, toolName });
  return projectId;
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
