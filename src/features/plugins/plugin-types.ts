import { z } from "zod";

/**
 * Declarative plugin manifest v1 (§41-42). Plugins package existing Evir
 * capabilities (slash commands, skills, settings toggles) — NO arbitrary
 * JS/Node execution, no UI slots, no shell. All contributed content is
 * declared inline in the manifest, so nothing from the source folder is read
 * after install.
 */

export const PLUGIN_PERMISSIONS = ["slash-commands", "skills", "settings"] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/** Derive the permissions a manifest actually exercises (trust but label). */
export function effectivePermissions(manifest: PluginManifest): PluginPermission[] {
  const used: PluginPermission[] = [];
  if (manifest.contributes?.slashCommands?.length) used.push("slash-commands");
  if (manifest.contributes?.skills?.length) used.push("skills");
  if (manifest.contributes?.settings?.length) used.push("settings");
  return used;
}

/** Values a plugin setting can hold (PLUG-1: typed settings, not just toggles). */
export type PluginSettingValue = boolean | string | number;

const settingKeyPattern = /^[a-z0-9-]{1,40}$/;
const settingLabel = z.string().min(1).max(80);

const booleanSettingSchema = z.object({
  key: z.string().regex(settingKeyPattern),
  label: settingLabel,
  type: z.literal("boolean"),
  default: z.boolean(),
});

const stringSettingSchema = z.object({
  key: z.string().regex(settingKeyPattern),
  label: settingLabel,
  type: z.literal("string"),
  /** Stored values are user input into a settings field — bounded, not free disk. */
  default: z.string().max(2_000),
});

const numberSettingSchema = z.object({
  key: z.string().regex(settingKeyPattern),
  label: settingLabel,
  type: z.literal("number"),
  default: z.number().finite(),
});

const selectSettingSchema = z
  .object({
    key: z.string().regex(settingKeyPattern),
    label: settingLabel,
    type: z.literal("select"),
    default: z.string().max(80),
    /** A select without options renders nothing usable — reject at parse time. */
    options: z.array(z.string().min(1).max(80)).min(1).max(20),
  })
  .refine((setting) => setting.options.includes(setting.default), {
    message: "select default must be one of options",
  });

export const pluginSettingSchema = z.discriminatedUnion("type", [
  booleanSettingSchema,
  stringSettingSchema,
  numberSettingSchema,
  selectSettingSchema,
]);

export type PluginSetting = z.infer<typeof pluginSettingSchema>;

const pluginIdPattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const semverishPattern = /^\d+\.\d+\.\d+[-+.\w]*$/;

export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(pluginIdPattern),
  name: z.string().min(1).max(60),
  version: z.string().regex(semverishPattern),
  description: z.string().max(300).optional(),
  author: z.string().max(80).optional(),
  homepage: z.string().url().max(300).optional(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).max(8).optional(),
  contributes: z
    .object({
      /** PLUG-2: read `<plugin>/skills/<id>/SKILL.md` at install time (via the
       * Rust path-bounded command) and copy bodies into the record — the
       * literal is fixed so a manifest cannot point at arbitrary folders. */
      skillsFrom: z.literal("skills/").optional(),
      slashCommands: z
        .array(
          z.object({
            id: z.string().regex(pluginIdPattern),
            description: z.string().max(200).optional(),
            /** Text inserted into the composer when the command runs. */
            promptTemplate: z.string().max(4_000).optional(),
          }),
        )
        .max(20)
        .optional(),
      skills: z
        .array(
          z.object({
            id: z.string().regex(pluginIdPattern),
            name: z.string().min(1).max(60),
            description: z.string().max(300),
            /** Skill body declared inline — never read from disk at runtime. */
            content: z.string().max(60_000),
            riskLevel: z.enum(["low", "medium", "high"]).optional(),
          }),
        )
        .max(20)
        .optional(),
      settings: z.array(pluginSettingSchema).max(10).optional(),
    })
    .optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description?: string | undefined;
  author?: string | undefined;
  homepage?: string | undefined;
  /** Source folder the manifest was installed from (desktop, install-time). */
  sourcePath: string;
  permissions: PluginPermission[];
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export const pluginRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  sourcePath: z.string(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  manifest: pluginManifestSchema,
  enabled: z.boolean(),
  installedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type PluginStatus = "installed" | "enabled" | "disabled" | "broken";

export function pluginStatus(record: PluginRecord): PluginStatus {
  if (!record.enabled) return "disabled";
  return "enabled";
}

/** Permission diff for reinstalls (§44): new grants must be re-confirmed. */
export function permissionDiff(
  previous: readonly PluginPermission[],
  next: readonly PluginPermission[],
): PluginPermission[] {
  return next.filter((permission) => !previous.includes(permission));
}
