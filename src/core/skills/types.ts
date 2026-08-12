export type SkillSource = "builtin" | "local" | "imported" | "created";
export type SkillRiskLevel = "low" | "medium" | "high";
export type SkillPlatform = "web" | "desktop";

export interface SkillPermission {
  requiredTools: string[];
  allowedCommands: string[];
}

export interface SkillAttribution {
  author: string;
  repository: string;
  license: string;
  upstreamPath: string;
  upstreamRevision: string;
  adapted: boolean;
}

export interface SkillLocalization {
  name: string;
  description: string;
}

export interface SkillManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  source: SkillSource;
  capabilities: string[];
  optionalCapabilities: string[];
  optionalMcpServers: string[];
  riskLevel: SkillRiskLevel;
  category?: string;
  categoryLocalizations?: Partial<Record<"en" | "zh-CN", string>>;
  platforms?: SkillPlatform[];
  localizations?: Partial<Record<"en" | "zh-CN", SkillLocalization>>;
  triggers?: string[];
  attribution?: SkillAttribution;
  permissions?: SkillPermission;
}

export interface InstalledSkill {
  manifest: SkillManifest;
  rootPath: string;
  builtIn: boolean;
}

const SKILL_ID_PATTERN = /^[a-z0-9-]+$/;
const VALID_RISK_LEVELS: SkillRiskLevel[] = ["low", "medium", "high"];

export function validateManifest(manifest: SkillManifest): string[] {
  const errors: string[] = [];

  if (!SKILL_ID_PATTERN.test(manifest.id)) {
    errors.push(`id must match ${SKILL_ID_PATTERN}`);
  }

  if (manifest.name.length < 1 || manifest.name.length > 100) {
    errors.push("name must be between 1 and 100 characters");
  }

  if (!manifest.version) {
    errors.push("version is required");
  }

  if (!VALID_RISK_LEVELS.includes(manifest.riskLevel)) {
    errors.push(`riskLevel must be one of ${VALID_RISK_LEVELS.join(", ")}`);
  }

  if (manifest.platforms !== undefined) {
    if (
      !Array.isArray(manifest.platforms) ||
      manifest.platforms.length === 0 ||
      !manifest.platforms.every((platform) => platform === "web" || platform === "desktop")
    ) {
      errors.push("platforms must include web or desktop");
    }
  }

  if (manifest.category !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.category)) {
    errors.push("category must be a lowercase slug of at most 64 characters");
  }

  if (manifest.categoryLocalizations !== undefined) {
    for (const [locale, label] of Object.entries(manifest.categoryLocalizations)) {
      if ((locale !== "en" && locale !== "zh-CN") || !label.trim()) {
        errors.push(`categoryLocalizations.${locale} is invalid`);
      }
    }
  }

  if (typeof manifest.entry !== "string" || manifest.entry.trim().length === 0) {
    errors.push("entry is required");
  }

  if (
    !Array.isArray(manifest.capabilities) ||
    !manifest.capabilities.every((c) => typeof c === "string")
  ) {
    errors.push("capabilities must be an array of strings");
  }

  if (
    !Array.isArray(manifest.optionalCapabilities) ||
    !manifest.optionalCapabilities.every((c) => typeof c === "string")
  ) {
    errors.push("optionalCapabilities must be an array of strings");
  }

  if (
    manifest.triggers !== undefined &&
    (!Array.isArray(manifest.triggers) ||
      !manifest.triggers.every(
        (trigger) => typeof trigger === "string" && trigger.trim().length > 1,
      ))
  ) {
    errors.push("triggers must be an array of non-empty strings");
  }

  if (manifest.localizations !== undefined) {
    for (const [locale, localization] of Object.entries(manifest.localizations)) {
      if (locale !== "en" && locale !== "zh-CN") {
        errors.push(`unsupported localization: ${locale}`);
      }
      if (!localization?.name.trim() || !localization.description.trim()) {
        errors.push(`localizations.${locale} requires name and description`);
      }
    }
  }

  if (manifest.attribution !== undefined) {
    const { author, repository, license, upstreamPath, upstreamRevision, adapted } =
      manifest.attribution;
    if (!author.trim()) errors.push("attribution.author is required");
    if (!/^https:\/\/github\.com\//.test(repository)) {
      errors.push("attribution.repository must be an HTTPS GitHub URL");
    }
    if (!license.trim()) errors.push("attribution.license is required");
    if (!upstreamPath.trim()) errors.push("attribution.upstreamPath is required");
    if (!/^[a-f0-9]{7,40}$/.test(upstreamRevision)) {
      errors.push("attribution.upstreamRevision must be a Git commit revision");
    }
    if (typeof adapted !== "boolean") errors.push("attribution.adapted must be a boolean");
  }

  if (manifest.permissions !== undefined) {
    const { requiredTools, allowedCommands } = manifest.permissions;
    if (!Array.isArray(requiredTools) || !requiredTools.every((t) => typeof t === "string")) {
      errors.push("permissions.requiredTools must be an array of strings");
    }
    if (!Array.isArray(allowedCommands) || !allowedCommands.every((c) => typeof c === "string")) {
      errors.push("permissions.allowedCommands must be an array of strings");
    }
  }

  return errors;
}

export function skillSupportsPlatform(manifest: SkillManifest, platform: SkillPlatform): boolean {
  return (manifest.platforms ?? ["web", "desktop"]).includes(platform);
}
