import type {
  ComponentConfiguration,
  ComponentConfigurationMap,
} from "../../core/components/types";
import type { SettingRecord } from "../../core/storage/db";
import { getStructuredStorage } from "../../runtime/structured-storage";

/**
 * Persisted component switches (`settings/componentConfiguration`).
 *
 * Opt-in components ship disabled, so a switch that survives a restart is the
 * only way a user can ever reach them. The stored value is the whole map:
 * anything malformed is dropped instead of guessed at, so a corrupt row can
 * never enable a component by accident.
 */

export const COMPONENT_CONFIGURATION_KEY = "componentConfiguration";

export function normalizeComponentConfiguration(value: unknown): ComponentConfigurationMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, ComponentConfiguration> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const enabled = (raw as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") continue;
    normalized[id] = { enabled };
  }
  return normalized;
}

export async function loadComponentConfiguration(): Promise<ComponentConfigurationMap> {
  const record = await getStructuredStorage().read<SettingRecord>(
    "settings",
    COMPONENT_CONFIGURATION_KEY,
  );
  return normalizeComponentConfiguration(record?.value);
}

export async function saveComponentConfiguration(
  configuration: ComponentConfigurationMap,
): Promise<void> {
  await getStructuredStorage().write("settings", COMPONENT_CONFIGURATION_KEY, {
    name: COMPONENT_CONFIGURATION_KEY,
    value: configuration,
  });
}
