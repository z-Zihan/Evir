import { create } from "zustand";
import { z } from "zod";
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
  type PluginSettingValue,
} from "./plugin-types";
import { usePluginContributionStore } from "./plugin-contributions";

/**
 * Plugin lifecycle v1 (§43-48): declarative manifests installed from a local
 * folder (desktop). Records persist in the per-profile `plugins` entity, so
 * enablement/settings are user-scoped by construction. Enable/disable
 * recomputes contributions live: slash commands enter/leave the palette and
 * skills enter/leave the skill catalog without a restart.
 */

/** Per-skill metadata file (skills/<id>/manifest.json) — metadata only. */
const skillMetaSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(300).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
});

/** What plugin_read_skills returns per direct subdirectory of skills/. */
const skillFileSchema = z.object({
  id: z.string().min(1).max(64),
  skillMd: z.string(),
  manifestJson: z.string().nullable(),
  truncated: z.boolean(),
});

interface PluginState {
  plugins: PluginRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Desktop: pick a folder, validate its manifest, return it for confirmation. */
  readManifestFromFolder: () => Promise<PluginManifest & { sourcePath: string }>;
  /** PLUG-2: expand `contributes.skillsFrom` into inline skills via the
   * Rust path-bounded read; bodies are copied into the manifest so nothing
   * is read from the source folder after install. Returns the expanded
   * manifest plus per-file truncation flags for the confirm UI. */
  expandSkillsFromFolder: (
    manifest: PluginManifest,
    sourcePath: string,
  ) => Promise<{ manifest: PluginManifest; truncatedSkills: string[] }>;
  install: (manifest: PluginManifest, sourcePath: string) => Promise<PluginRecord>;
  uninstall: (pluginId: string) => Promise<void>;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  getSetting: (
    pluginId: string,
    key: string,
    fallback: PluginSettingValue,
  ) => Promise<PluginSettingValue>;
  setSetting: (pluginId: string, key: string, value: PluginSettingValue) => Promise<void>;
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
        pluginName: plugin.name,
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

  expandSkillsFromFolder: async (manifest, sourcePath) => {
    if (manifest.contributes?.skillsFrom !== "skills/") {
      return { manifest, truncatedSkills: [] };
    }
    if (!("__TAURI_INTERNALS__" in globalThis)) throw new Error("plugins.desktopOnly");
    const files = skillFileSchema
      .array()
      .parse(await tauriInvoke<unknown[]>("plugin_read_skills", { folder: sourcePath }));
    const truncatedSkills = files.filter((file) => file.truncated).map((file) => file.id);
    const expanded = files.map((file) => {
      let meta: z.infer<typeof skillMetaSchema> = {};
      if (file.manifestJson !== null) {
        meta = skillMetaSchema.parse(JSON.parse(file.manifestJson));
      }
      return {
        id: file.id,
        name: meta.name ?? file.id,
        description: meta.description ?? `Skill from plugin ${manifest.name}`,
        content: file.skillMd,
        ...(meta.riskLevel !== undefined ? { riskLevel: meta.riskLevel } : {}),
      };
    });
    // Inline skills win the id namespace: a collision between declared and
    // folder skills is a manifest bug, reject instead of silently dropping.
    const inline = manifest.contributes?.skills ?? [];
    const ids = new Set(expanded.map((skill) => skill.id));
    if (inline.some((skill) => ids.has(skill.id))) {
      throw new Error("plugins.skillIdCollision");
    }
    const merged = [...inline, ...expanded];
    if (merged.length > 20) throw new Error("plugins.tooManySkills");
    const next: PluginManifest = {
      ...manifest,
      contributes: { ...manifest.contributes, skills: merged },
    };
    // Re-validate the expanded manifest through the same schema the record
    // persists with — folder content must satisfy the inline-skill contract.
    pluginManifestSchema.parse(next);
    return { manifest: next, truncatedSkills };
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
      value: Record<string, PluginSettingValue>;
    }>("settings", settingKey(pluginId));
    const value: PluginSettingValue | undefined = record?.value?.[key];
    // Type-aware read: a stored value whose type no longer matches the
    // manifest's declared type (plugin updated the schema) falls back to the
    // declared default instead of leaking a stale value into a new control.
    return value !== undefined && typeof value === typeof fallback ? value : fallback;
  },

  setSetting: async (pluginId, key, value) => {
    // Reject values that bypass the settings contract (PLUG-1: Zod-validated
    // manifest types are the only accepted shapes).
    if (typeof value !== "boolean" && typeof value !== "string" && typeof value !== "number") {
      throw new Error("plugin setting value must be boolean, string, or number");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("plugin setting number must be finite");
    }
    if (typeof value === "string" && value.length > 2_000) {
      throw new Error("plugin setting string exceeds length bound");
    }
    const record = await getStructuredStorage().read<{
      name: string;
      value: Record<string, PluginSettingValue>;
    }>("settings", settingKey(pluginId));
    const next = { ...(record?.value ?? {}), [key]: value };
    await getStructuredStorage().write("settings", settingKey(pluginId), {
      name: settingKey(pluginId),
      value: next,
    });
  },
}));
