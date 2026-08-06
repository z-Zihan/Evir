export type SkillSource = "builtin" | "local" | "imported" | "created";
export type SkillRiskLevel = "low" | "medium" | "high";

export interface SkillPermission {
  requiredTools: string[];
  allowedCommands: string[];
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
