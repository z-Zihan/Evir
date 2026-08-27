import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../../core/logging/logger";

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
      getEnabledContent: async (enabledIds: Set<string>) => {
        await Promise.resolve();
        const enabled = currentSkills.filter((s) => enabledIds.has(s.manifest.id));
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
    logger.clear();
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
    expect(logger.getEntries().at(-1)).toMatchObject({
      channel: "skill",
      event: "skill.enabled-changed",
      data: { skillId: "bug-fix", enabled: true },
    });
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

  it("loads only routed content when selected ids are provided", async () => {
    await useSkillStore.getState().toggleSkill("bug-fix");
    await useSkillStore.getState().toggleSkill("code-review");

    const content = await useSkillStore.getState().getEnabledContent(new Set(["code-review"]));

    expect(content).toContain("Code Review");
    expect(content).not.toContain("Bug Fix");
  });

  it("loads explicitly selected content even when the Skill is globally disabled", async () => {
    const content = await useSkillStore.getState().getSkillContent(new Set(["code-review"]));

    expect(useSkillStore.getState().enabledSkillIds.size).toBe(0);
    expect(content).toContain("Code Review");
    expect(content).not.toContain("Bug Fix");
  });

  it("preserves a user-defined non-Latin category label", async () => {
    const id = await useSkillStore
      .getState()
      .createSkill("Campaign Helper", "Campaign helper", "Instructions", "营销");
    const created = useSkillStore.getState().skills.find((skill) => skill.manifest.id === id);

    expect(created?.manifest.category).toMatch(/^custom-[a-z0-9]+$/);
    expect(created?.manifest.categoryLocalizations).toEqual({ en: "营销", "zh-CN": "营销" });
  });

  const customManifest = {
    schemaVersion: 1 as const,
    id: "my-custom-skill",
    name: "My Custom Skill",
    version: "0.1.0",
    description: "A custom test skill",
    entry: "SKILL.md",
    source: "imported" as const,
    capabilities: [],
    optionalCapabilities: [],
    optionalMcpServers: [],
    riskLevel: "low" as const,
  };

  describe("installSkill", () => {
    it("installs a valid custom skill", async () => {
      const id = await useSkillStore.getState().installSkill(customManifest, "custom content");
      expect(id).toBe("my-custom-skill");
      const { skills } = useSkillStore.getState();
      expect(skills.some((s) => s.manifest.id === id)).toBe(true);
    });

    it("rejects an invalid manifest", async () => {
      const invalid = { ...customManifest, id: "Invalid ID!" };
      await expect(useSkillStore.getState().installSkill(invalid, "content")).rejects.toThrow();
    });

    it("rejects installing a duplicate id", async () => {
      await useSkillStore.getState().installSkill(customManifest, "custom content");
      await expect(
        useSkillStore.getState().installSkill(customManifest, "other content"),
      ).rejects.toThrow(/already installed/);
    });
  });

  describe("uninstallSkill", () => {
    it("removes an installed skill and its enabled state", async () => {
      await useSkillStore.getState().installSkill(customManifest, "custom content");
      await useSkillStore.getState().toggleSkill(customManifest.id);
      expect(useSkillStore.getState().isEnabled(customManifest.id)).toBe(true);

      await useSkillStore.getState().uninstallSkill(customManifest.id);

      const { skills, enabledSkillIds } = useSkillStore.getState();
      expect(skills.some((s) => s.manifest.id === customManifest.id)).toBe(false);
      expect(enabledSkillIds.has(customManifest.id)).toBe(false);
    });

    it("no longer includes uninstalled skill content in getEnabledContent", async () => {
      await useSkillStore.getState().installSkill(customManifest, "custom content");
      await useSkillStore.getState().toggleSkill(customManifest.id);
      await useSkillStore.getState().uninstallSkill(customManifest.id);

      const content = await useSkillStore.getState().getEnabledContent();
      expect(content).not.toContain("custom content");
    });
  });

  describe("updateSkill", () => {
    it("updates content and description of an installed skill", async () => {
      await useSkillStore.getState().installSkill(customManifest, "original content");
      await useSkillStore
        .getState()
        .updateSkill(customManifest.id, "updated content", "new description");

      const { skills } = useSkillStore.getState();
      const updated = skills.find((s) => s.manifest.id === customManifest.id);
      expect(updated?.manifest.description).toBe("new description");
    });

    it("includes updated content for enabled custom skills via getEnabledContent", async () => {
      await useSkillStore.getState().installSkill(customManifest, "original content");
      await useSkillStore.getState().toggleSkill(customManifest.id);
      await useSkillStore.getState().updateSkill(customManifest.id, "updated content");

      const content = await useSkillStore.getState().getEnabledContent();
      expect(content).toContain("updated content");
      expect(content).not.toContain("original content");
    });

    it("throws when updating a skill that does not exist", async () => {
      await expect(
        useSkillStore.getState().updateSkill("does-not-exist", "content"),
      ).rejects.toThrow(/not found/);
    });
  });

  it("getEnabledContent includes custom skill content from DB alongside builtin content", async () => {
    await useSkillStore.getState().installSkill(customManifest, "custom skill body");
    await useSkillStore.getState().toggleSkill(customManifest.id);
    await useSkillStore.getState().toggleSkill("bug-fix");

    const content = await useSkillStore.getState().getEnabledContent();
    expect(content).toContain("Bug Fix");
    expect(content).toContain("Content for bug fix");
    expect(content).toContain("My Custom Skill");
    expect(content).toContain("custom skill body");
  });
});
