export type SkillSource = "builtin" | "local" | "imported" | "created";
export type SkillRiskLevel = "low" | "medium" | "high";

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
}

export interface InstalledSkill {
  manifest: SkillManifest;
  rootPath: string;
  enabled: boolean;
  builtIn: boolean;
}
