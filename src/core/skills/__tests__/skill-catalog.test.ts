import { describe, expect, it } from "vitest";
import { createSkillRegistry } from "../skill-registry";
import { validateManifest } from "../types";
import { findSkillTriggerConflicts } from "../skill-router";
import { BUILTIN_SKILL_CATEGORIES } from "../skill-categories";

describe("built-in skill catalog", () => {
  it("keeps the Web catalog to the ten shared instruction skills", async () => {
    const registry = createSkillRegistry("web");
    const skills = await registry.loadBuiltin();

    expect(skills).toHaveLength(10);
    expect(skills.every((skill) => skill.manifest.platforms?.includes("web"))).toBe(true);
  });

  it("adds a desktop-only local-work catalog without exposing it to Web", async () => {
    const webRegistry = createSkillRegistry("web");
    const desktopRegistry = createSkillRegistry("desktop");
    const webSkills = await webRegistry.loadBuiltin();
    const desktopSkills = await desktopRegistry.loadBuiltin();

    // No fixed-count gate: the catalog is protected by capability assertions
    // (core coding skills discoverable, web stays instruction-only), not by
    // a number KPI (Skill Audit 2026-09-04).
    expect(desktopSkills.length).toBeGreaterThan(webSkills.length);
    expect(desktopSkills.map((skill) => skill.manifest.id)).toEqual(
      expect.arrayContaining([
        "code-review",
        "data-analysis",
        "file-organization",
        "git-delivery",
        "project-onboarding",
        "release-readiness",
        "meeting-minutes",
        "github-actions-hardening",
        "technical-spike",
        "privacy-compliance-review",
        "credit-risk-analysis",
      ]),
    );
    expect(webSkills.map((skill) => skill.manifest.id)).not.toEqual(
      expect.arrayContaining(["code-review", "file-organization", "git-delivery"]),
    );
    await expect(webRegistry.getSkillContent("code-review")).resolves.toBe("");
  });

  it("marks a curated core-coding tier that stays discoverable and valid", async () => {
    const registry = createSkillRegistry("desktop");
    const skills = await registry.loadBuiltin();
    const core = skills.filter((skill) => skill.manifest.tier === "core");

    // The core tier is the marketed builtin set: the coding/project-agent
    // skills below must stay present; general skills may change freely.
    expect(core.map((skill) => skill.manifest.id)).toEqual(
      expect.arrayContaining([
        "systematic-debugging",
        "test-driven-development",
        "code-review",
        "security-review",
        "implementation-planning",
        "verification-before-completion",
        "git-delivery",
        "dependency-update-planning",
      ]),
    );
    expect(core.length).toBeGreaterThan(0);
    expect(core.length).toBeLessThan(skills.length);
    for (const skill of core) {
      expect(skill.manifest.platforms, skill.manifest.id).toContain("desktop");
    }
  });

  it("loads the curated catalog with valid provenance", async () => {
    const registry = createSkillRegistry("desktop");
    const skills = await registry.loadBuiltin();

    expect(new Set(skills.map((skill) => skill.manifest.id)).size).toBe(skills.length);
    for (const skill of skills) {
      expect(validateManifest(skill.manifest), skill.manifest.id).toEqual([]);
      expect(skill.manifest.attribution?.repository, skill.manifest.id).toMatch(
        /^https:\/\/github\.com\//,
      );
      expect(skill.manifest.attribution?.license, skill.manifest.id).toMatch(/^(MIT|Apache-2\.0)$/);
      expect(skill.manifest.attribution?.adapted, skill.manifest.id).toBe(true);
      expect(skill.manifest.triggers?.length, skill.manifest.id).toBeGreaterThanOrEqual(6);
      expect(skill.manifest.localizations?.["zh-CN"]?.name, skill.manifest.id).toBeTruthy();
      expect(skill.manifest.localizations?.["zh-CN"]?.description, skill.manifest.id).toBeTruthy();
      expect(skill.manifest.platforms?.length, skill.manifest.id).toBeGreaterThan(0);
      expect(skill.manifest.category, skill.manifest.id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(findSkillTriggerConflicts(skills)).toEqual([]);
    expect(new Set(skills.map((skill) => skill.manifest.category))).toEqual(
      new Set(BUILTIN_SKILL_CATEGORIES.filter((category) => category !== "other")),
    );
  });

  it("bundles self-contained content for every catalog entry", async () => {
    const registry = createSkillRegistry("desktop");
    const skills = await registry.loadBuiltin();

    for (const skill of skills) {
      const content = await registry.getSkillContent(skill.manifest.id);
      expect(content.length, skill.manifest.id).toBeGreaterThan(300);
      expect(content, skill.manifest.id).toMatch(
        new RegExp(`^---\\nname: ${skill.manifest.id}\\ndescription: [^\\n]+\\n---`),
      );
      expect(content, skill.manifest.id).not.toMatch(/\]\((?:references|assets|scripts)\//);
      expect(content, skill.manifest.id).not.toMatch(/~\/(?:\.claude|agentic-coding|code)\//);
    }
  });
});
