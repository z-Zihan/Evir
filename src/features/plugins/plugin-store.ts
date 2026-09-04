import { create } from "zustand";
import { tauriInvoke } from "../../runtime/tauri-ipc";
import { getRuntime } from "../../runtime/use-runtime";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { useSkillStore } from "../skills/skill-store";
import { logger } from "../../core/logging/logger";
import {
  effectivePermissions,
  permissionDiff,
  pluginManifestSchema,
  pluginRecordSchema,
  type PluginManifest,
  type PluginRecord,
} from "./plugin-types";
import { usePluginContributionStore } from "./plugin-contributions";

/**
 * Plugin lifecycle v1 (§43-48): declarative manifests installed from a local
 * folder (desktop). Records persist in the per-profile `plugins` entity, so
 * enablement/settings are user-scoped by construction. Enable/disable
 * recomputes contributions live: slash commands enter/leave the palette and
 * skills enter/leave the skill catalog without a restart.
 */

interface PluginState {
  plugins: PluginRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Desktop: pick a folder, validate its manifest, return it for confirmation. */
  readManifestFromFolder: () => Promise<PluginManifest & { sourcePath: string }>;
  install: (manifest: PluginManifest, sourcePath: string) => Promise<PluginRecord>;
  uninstall: (pluginId: string) => Promise<void>;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  getSetting: (pluginId: string, key: string, fallback: boolean) => Promise<boolean>;
  setSetting: (pluginId: string, key: string, value: boolean) => Promise<void>;
}

function settingKey(pluginId: string): string {
  return `plugin:${pluginId}`;
}

async function writeRecord(record: PluginRecord): Promise<void> {
  await getStructuredStorage().write("plugins", record.id, record);
}

/** Recompute palette/skill contributions from the enabled set. */
async function publishContributions(plugins: PluginRecord[]): Promise<void> {
  const enabled = plugins.filter((plugin) => plugin.enabled);
  usePluginContributionStore.getState().replaceSlashCommands(
    enabled.flatMap((plugin) =>
      (plugin.manifest.contributes?.slashCommands ?? []).map((command) => ({
        pluginId: plugin.id,
        id: command.id,
        description: command.description ?? `${plugin.name} command`,
        run: () => {
          // Declarative behavior: insert the prompt template into the
          // composer. No arbitrary code ever runs.
          window.dispatchEvent(
            new CustomEvent("evir:plugin-command", {
              detail: { template: command.promptTemplate ?? "" },
            }),
          );
        },
      })),
    ),
  );
  const skillEntries = enabled.flatMap((plugin) =>
    (plugin.manifest.contributes?.skills ?? []).map((skill) => ({
      pluginId: plugin.id,
      manifest: {
        schemaVersion: 1 as const,
        id: `${plugin.id}--${skill.id}`,
        name: skill.name,
        version: plugin.version,
        description: skill.description,
        entry: "manifest.json",
        source: "imported" as const,
        capabilities: [],
        optionalCapabilities: [],
        optionalMcpServers: [],
        riskLevel: skill.riskLevel ?? "low",
      },
      content: skill.content,
    })),
  );
  await useSkillStore.getState().mergePluginSkills(skillEntries);
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  loaded: false,

  load: async () => {
    try {
      const records = await getStructuredStorage().readAll<PluginRecord>("plugins");
      const parsed = records.flatMap((record) => {
        const result = pluginRecordSchema.safeParse(record);
        if (!result.success) {
          logger.warn("skill", "plugin.record-invalid", {
            pluginId: (record as { id?: string })?.id ?? "unknown",
          });
          return [];
        }
        return [result.data];
      });
      set({ plugins: parsed, loaded: true });
      await publishContributions(parsed);
    } catch (error) {
      set({ loaded: true });
      logger.warn("skill", "plugin.load-failed", {
        errorType: error instanceof Error ? error.name : "Error",
      });
    }
  },

  readManifestFromFolder: async () => {
    const runtime = getRuntime();
    const folder = await runtime.selectWorkspaceDirectory?.();
    if (!folder) throw new Error("plugins.cancelled");
    if (!("__TAURI_INTERNALS__" in globalThis)) throw new Error("plugins.desktopOnly");
    const raw = await tauriInvoke<string>("plugin_read_manifest", { folder });
    const manifest = pluginManifestSchema.parse(JSON.parse(raw));
    return { ...manifest, sourcePath: folder };
  },

  install: async (manifest, sourcePath) => {
    const existing = get().plugins.find((plugin) => plugin.id === manifest.id);
    // Reinstall with newly granted permissions is the caller's decision to
    // confirm (permissionDiff is surfaced by the settings UI); the store just
    // records the outcome atomically.
    const usedPermissions = effectivePermissions(manifest);
    const now = Date.now();
    // Assigned field-by-field: conditional spreads widen to `| undefined`
    // under exactOptionalPropertyTypes.
    const record: PluginRecord = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      sourcePath,
      permissions: usedPermissions,
      manifest,
      enabled: existing?.enabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };
    if (manifest.description !== undefined) record.description = manifest.description;
    if (manifest.author !== undefined) record.author = manifest.author;
    if (manifest.homepage !== undefined) record.homepage = manifest.homepage;
    await writeRecord(record);
    const next = [...get().plugins.filter((plugin) => plugin.id !== record.id), record];
    set({ plugins: next });
    await publishContributions(next);
    logger.info("skill", "plugin.installed", {
      pluginId: record.id,
      version: record.version,
      newPermissions: existing
        ? permissionDiff(existing.permissions, usedPermissions)
        : usedPermissions,
    });
    return record;
  },

  uninstall: async (pluginId) => {
    await getStructuredStorage().delete("plugins", pluginId);
    await getStructuredStorage().delete("settings", settingKey(pluginId));
    const next = get().plugins.filter((plugin) => plugin.id !== pluginId);
    set({ plugins: next });
    await publishContributions(next);
    logger.info("skill", "plugin.uninstalled", { pluginId });
  },

  setEnabled: async (pluginId, enabled) => {
    const plugin = get().plugins.find((candidate) => candidate.id === pluginId);
    if (!plugin) throw new Error(`plugin not found: ${pluginId}`);
    const updated: PluginRecord = { ...plugin, enabled, updatedAt: Date.now() };
    await writeRecord(updated);
    const next = get().plugins.map((candidate) =>
      candidate.id === pluginId ? updated : candidate,
    );
    set({ plugins: next });
    await publishContributions(next);
    logger.info("skill", "plugin.enabled-changed", { pluginId, enabled });
  },

  getSetting: async (pluginId, key, fallback) => {
    const record = await getStructuredStorage().read<{
      name: string;
      value: Record<string, boolean>;
    }>("settings", settingKey(pluginId));
    const value = record?.value?.[key];
    return typeof value === "boolean" ? value : fallback;
  },

  setSetting: async (pluginId, key, value) => {
    const record = await getStructuredStorage().read<{
      name: string;
      value: Record<string, boolean>;
    }>("settings", settingKey(pluginId));
    const next = { ...(record?.value ?? {}), [key]: value };
    await getStructuredStorage().write("settings", settingKey(pluginId), {
      name: settingKey(pluginId),
      value: next,
    });
  },
}));
