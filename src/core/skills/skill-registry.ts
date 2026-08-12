import { skillSupportsPlatform } from "./types";
import type { InstalledSkill, SkillManifest, SkillRiskLevel } from "./types";
import type { RuntimeTarget } from "../../runtime/types";

const SKILL_ID_PATTERN = /^[a-z0-9-]+$/;

const sharedManifests = import.meta.glob<SkillManifest>(
  [
    "/skills/builtin/architecture-decision-record/manifest.json",
    "/skills/builtin/documentation-writing/manifest.json",
    "/skills/builtin/frontend-design/manifest.json",
    "/skills/builtin/implementation-planning/manifest.json",
    "/skills/builtin/requirements-discovery/manifest.json",
    "/skills/builtin/security-review/manifest.json",
    "/skills/builtin/skill-creator/manifest.json",
    "/skills/builtin/systematic-debugging/manifest.json",
    "/skills/builtin/test-driven-development/manifest.json",
    "/skills/builtin/verification-before-completion/manifest.json",
  ],
  {
    eager: true,
    import: "default",
  },
);

const sharedSkillMds = import.meta.glob<string>(
  [
    "/skills/builtin/architecture-decision-record/SKILL.md",
    "/skills/builtin/documentation-writing/SKILL.md",
    "/skills/builtin/frontend-design/SKILL.md",
    "/skills/builtin/implementation-planning/SKILL.md",
    "/skills/builtin/requirements-discovery/SKILL.md",
    "/skills/builtin/security-review/SKILL.md",
    "/skills/builtin/skill-creator/SKILL.md",
    "/skills/builtin/systematic-debugging/SKILL.md",
    "/skills/builtin/test-driven-development/SKILL.md",
    "/skills/builtin/verification-before-completion/SKILL.md",
  ],
  {
    query: "?raw",
    import: "default",
  },
);

const includeDesktopCatalog =
  import.meta.env.VITE_EVIR_TARGET === "desktop" || import.meta.env.MODE === "test";

const desktopManifests = includeDesktopCatalog
  ? import.meta.glob<SkillManifest>(
      [
        "/skills/builtin/code-review/manifest.json",
        "/skills/builtin/code-tour/manifest.json",
        "/skills/builtin/cli-design/manifest.json",
        "/skills/builtin/context-mapping/manifest.json",
        "/skills/builtin/credit-risk-analysis/manifest.json",
        "/skills/builtin/data-analysis/manifest.json",
        "/skills/builtin/daily-focus/manifest.json",
        "/skills/builtin/dependency-update-planning/manifest.json",
        "/skills/builtin/diagramming/manifest.json",
        "/skills/builtin/email-drafting/manifest.json",
        "/skills/builtin/evidence-mapping/manifest.json",
        "/skills/builtin/file-organization/manifest.json",
        "/skills/builtin/git-delivery/manifest.json",
        "/skills/builtin/github-actions-hardening/manifest.json",
        "/skills/builtin/github-release-planning/manifest.json",
        "/skills/builtin/incident-postmortem/manifest.json",
        "/skills/builtin/meeting-minutes/manifest.json",
        "/skills/builtin/performance-review-writing/manifest.json",
        "/skills/builtin/privacy-compliance-review/manifest.json",
        "/skills/builtin/professional-post/manifest.json",
        "/skills/builtin/project-onboarding/manifest.json",
        "/skills/builtin/release-readiness/manifest.json",
        "/skills/builtin/sql-optimization/manifest.json",
        "/skills/builtin/sql-review/manifest.json",
        "/skills/builtin/system-command-planning/manifest.json",
        "/skills/builtin/technical-spike/manifest.json",
      ],
      {
        eager: true,
        import: "default",
      },
    )
  : {};

const desktopSkillMds = includeDesktopCatalog
  ? import.meta.glob<string>(
      [
        "/skills/builtin/code-review/SKILL.md",
        "/skills/builtin/code-tour/SKILL.md",
        "/skills/builtin/cli-design/SKILL.md",
        "/skills/builtin/context-mapping/SKILL.md",
        "/skills/builtin/credit-risk-analysis/SKILL.md",
        "/skills/builtin/data-analysis/SKILL.md",
        "/skills/builtin/daily-focus/SKILL.md",
        "/skills/builtin/dependency-update-planning/SKILL.md",
        "/skills/builtin/diagramming/SKILL.md",
        "/skills/builtin/email-drafting/SKILL.md",
        "/skills/builtin/evidence-mapping/SKILL.md",
        "/skills/builtin/file-organization/SKILL.md",
        "/skills/builtin/git-delivery/SKILL.md",
        "/skills/builtin/github-actions-hardening/SKILL.md",
        "/skills/builtin/github-release-planning/SKILL.md",
        "/skills/builtin/incident-postmortem/SKILL.md",
        "/skills/builtin/meeting-minutes/SKILL.md",
        "/skills/builtin/performance-review-writing/SKILL.md",
        "/skills/builtin/privacy-compliance-review/SKILL.md",
        "/skills/builtin/professional-post/SKILL.md",
        "/skills/builtin/project-onboarding/SKILL.md",
        "/skills/builtin/release-readiness/SKILL.md",
        "/skills/builtin/sql-optimization/SKILL.md",
        "/skills/builtin/sql-review/SKILL.md",
        "/skills/builtin/system-command-planning/SKILL.md",
        "/skills/builtin/technical-spike/SKILL.md",
      ],
      {
        query: "?raw",
        import: "default",
      },
    )
  : {};

const manifests: Record<string, SkillManifest> = {
  ...sharedManifests,
  ...desktopManifests,
};

const skillMds: Record<string, () => Promise<string>> = {
  ...sharedSkillMds,
  ...desktopSkillMds,
};

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
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

export interface SkillRegistry {
  loadBuiltin(): Promise<InstalledSkill[]>;
  getSkillContent(id: string): Promise<string>;
  list(): readonly InstalledSkill[];
  getEnabledContent(enabledIds: Set<string>): Promise<string>;
}

const BUILD_TARGET: RuntimeTarget =
  import.meta.env.VITE_EVIR_TARGET === "desktop" ? "desktop" : "web";

export function createSkillRegistry(target: RuntimeTarget = BUILD_TARGET): SkillRegistry {
  let skills: InstalledSkill[] = [];

  const loadBuiltin = async (): Promise<InstalledSkill[]> => {
    await Promise.resolve();
    const loaded: InstalledSkill[] = [];

    for (const [path, manifest] of Object.entries(manifests)) {
      if (!skillSupportsPlatform(manifest, target)) continue;
      const id = manifest.id || extractSkillId(path);
      loaded.push({
        manifest: { ...manifest, id },
        rootPath: path.replace(/\/manifest\.json$/, ""),
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
    if (!SKILL_ID_PATTERN.test(id)) return "";
    const manifest = Object.values(manifests).find((candidate) => candidate.id === id);
    if (!manifest || !skillSupportsPlatform(manifest, target)) return "";
    for (const [path, loadContent] of Object.entries(skillMds)) {
      if (path.includes(`/${id}/`)) {
        return loadContent();
      }
    }
    return "";
  };

  return {
    loadBuiltin,
    getSkillContent,
    list: () => skills,
    getEnabledContent: async (enabledIds: Set<string>) => {
      const enabled = skills.filter((s) => enabledIds.has(s.manifest.id));
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
