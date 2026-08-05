import type { InstalledSkill, SkillManifest, SkillRiskLevel } from "./types";

const manifests = import.meta.glob<SkillManifest>("/skills/builtin/*/manifest.json", {
  eager: true,
  import: "default",
});

const skillMds = import.meta.glob<string>("/skills/builtin/*/SKILL.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function extractSkillId(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] ?? "";
}

function riskLevelScore(level: SkillRiskLevel): number {
  switch (level) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export interface SkillRegistry {
  loadBuiltin(): Promise<InstalledSkill[]>;
  getSkillContent(id: string): Promise<string>;
  list(): readonly InstalledSkill[];
  listEnabled(): readonly InstalledSkill[];
  setEnabled(id: string, enabled: boolean): void;
  getEnabledContent(): Promise<string>;
}

export function createSkillRegistry(): SkillRegistry {
  let skills: InstalledSkill[] = [];

  const loadBuiltin = async (): Promise<InstalledSkill[]> => {
    await Promise.resolve();
    const loaded: InstalledSkill[] = [];

    for (const [path, manifest] of Object.entries(manifests)) {
      const id = manifest.id || extractSkillId(path);
      loaded.push({
        manifest: { ...manifest, id },
        rootPath: path.replace(/\/manifest\.json$/, ""),
        enabled: false,
        builtIn: true,
      });
    }

    loaded.sort(
      (a, b) => riskLevelScore(b.manifest.riskLevel) - riskLevelScore(a.manifest.riskLevel),
    );
    skills = loaded;
    return skills;
  };

  const getSkillContent = async (id: string): Promise<string> => {
    await Promise.resolve();
    for (const [path, content] of Object.entries(skillMds)) {
      if (path.includes(`/${id}/`)) {
        return content;
      }
    }
    return "";
  };

  return {
    loadBuiltin,
    getSkillContent,
    list: () => skills,
    listEnabled: () => skills.filter((s) => s.enabled),
    setEnabled: (id, enabled) => {
      const skill = skills.find((s) => s.manifest.id === id);
      if (skill) skill.enabled = enabled;
    },
    getEnabledContent: async () => {
      const enabled = skills.filter((s) => s.enabled);
      if (enabled.length === 0) return "";

      const contents = await Promise.all(
        enabled.map(async (s) => {
          const content = await getSkillContent(s.manifest.id);
          return `## ${s.manifest.name}\n\n${content}`;
        }),
      );
      return contents.join("\n\n---\n\n");
    },
  };
}
