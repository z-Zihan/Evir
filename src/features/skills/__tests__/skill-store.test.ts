import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/skills/skill-registry", () => {
  const baseSkills = [
    {
      manifest: {
        schemaVersion: 1 as const,
        id: "bug-fix",
        name: "Bug Fix",
        version: "0.1.0",
        description: "Reproduce, locate, fix, and verify bugs",
        entry: "SKILL.md",
        source: "builtin" as const,
        capabilities: [],
        optionalCapabilities: [],
        optionalMcpServers: [],
        riskLevel: "low" as const,
      },
      rootPath: "/skills/builtin/bug-fix",
      enabled: false,
      builtIn: true,
    },
    {
      manifest: {
        schemaVersion: 1 as const,
        id: "code-review",
        name: "Code Review",
        version: "0.1.0",
        description: "Review code for correctness and security",
        entry: "SKILL.md",
        source: "builtin" as const,
        capabilities: [],
        optionalCapabilities: [],
        optionalMcpServers: [],
        riskLevel: "medium" as const,
      },
      rootPath: "/skills/builtin/code-review",
      enabled: false,
      builtIn: true,
    },
  ];

  let currentSkills: typeof baseSkills = [];

  return {
    createSkillRegistry: () => ({
      loadBuiltin: async () => {
        await Promise.resolve();
        currentSkills = baseSkills.map((s) => ({ ...s }));
        return currentSkills;
      },
      getSkillContent: async (id: string) => {
        await Promise.resolve();
        if (id === "bug-fix") return "# Bug Fix Skill\n\nContent for bug fix.";
        if (id === "code-review") return "# Code Review Skill\n\nContent for code review.";
        return "";
      },
      list: () => currentSkills,
      listEnabled: () => currentSkills.filter((s) => s.enabled),
      setEnabled: (id: string, enabled: boolean) => {
        const skill = currentSkills.find((s) => s.manifest.id === id);
        if (skill) skill.enabled = enabled;
      },
      getEnabledContent: async () => {
        await Promise.resolve();
        const enabled = currentSkills.filter((s) => s.enabled);
        if (enabled.length === 0) return "";
        const contents: string[] = [];
        for (const s of enabled) {
          const c =
            s.manifest.id === "bug-fix"
              ? "# Bug Fix Skill\n\nContent for bug fix."
              : "# Code Review Skill\n\nContent for code review.";
          contents.push(`## ${s.manifest.name}\n\n${c}`);
        }
        return contents.join("\n\n---\n\n");
      },
    }),
  };
});

const { useSkillStore } = await import("../skill-store");

describe("skill-store", () => {
  beforeEach(async () => {
    const { db } = await import("../../../core/storage/db");
    await Promise.all(db.tables.map((t) => t.clear()));
    useSkillStore.setState({ skills: [], enabledSkillIds: new Set() });
    await useSkillStore.getState().loadSkills();
  });

  it("loads builtin skills", () => {
    const { skills } = useSkillStore.getState();
    expect(skills).toHaveLength(2);
    expect(skills[0]?.manifest.id).toBe("bug-fix");
    expect(skills[1]?.manifest.id).toBe("code-review");
  });

  it("starts with all skills disabled", () => {
    const { enabledSkillIds } = useSkillStore.getState();
    expect(enabledSkillIds.size).toBe(0);
  });

  it("toggleSkill enables a skill", async () => {
    await useSkillStore.getState().toggleSkill("bug-fix");
    const { enabledSkillIds, isEnabled } = useSkillStore.getState();
    expect(enabledSkillIds.has("bug-fix")).toBe(true);
    expect(isEnabled("bug-fix")).toBe(true);
  });

  it("toggleSkill disables an enabled skill", async () => {
    await useSkillStore.getState().toggleSkill("bug-fix");
    await useSkillStore.getState().toggleSkill("bug-fix");
    const { enabledSkillIds, isEnabled } = useSkillStore.getState();
    expect(enabledSkillIds.has("bug-fix")).toBe(false);
    expect(isEnabled("bug-fix")).toBe(false);
  });

  it("getEnabledContent returns empty when no skills enabled", async () => {
    const content = await useSkillStore.getState().getEnabledContent();
    expect(content).toBe("");
  });

  it("getEnabledContent returns content for enabled skills", async () => {
    await useSkillStore.getState().toggleSkill("bug-fix");
    const content = await useSkillStore.getState().getEnabledContent();
    expect(content).toContain("Bug Fix");
    expect(content).toContain("Content for bug fix");
    expect(content).not.toContain("Code Review");
  });
});
