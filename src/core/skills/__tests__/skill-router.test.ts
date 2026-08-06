import { describe, expect, it } from "vitest";
import { routeSkill } from "../skill-router";
import type { InstalledSkill } from "../types";

function makeSkill(id: string, name: string, desc: string): InstalledSkill {
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name,
      version: "0.1.0",
      description: desc,
      entry: "SKILL.md",
      source: "builtin",
      capabilities: [],
      optionalCapabilities: [],
      optionalMcpServers: [],
      riskLevel: "low",
    },
    rootPath: "",
    builtIn: true,
  };
}

const skills = [
  makeSkill("bug-fix", "Bug Fix", "复现、定位、最小修复并验证软件缺陷"),
  makeSkill("code-review", "Code Review", "审查代码质量、发现潜在问题"),
  makeSkill("task-planning", "Task Planning", "制定任务计划和待办事项"),
];

const enabled = new Set(["bug-fix", "code-review", "task-planning"]);

describe("routeSkill", () => {
  it("matches bug-fix by keyword", () => {
    const result = routeSkill("帮我修复这个 bug", skills, enabled);
    expect(result.matchedSkills.some((s) => s.manifest.id === "bug-fix")).toBe(true);
  });

  it("matches code-review by keyword", () => {
    const result = routeSkill("审查一下这段代码的质量", skills, enabled);
    expect(result.matchedSkills.some((s) => s.manifest.id === "code-review")).toBe(true);
  });

  it("matches task-planning by keyword", () => {
    const result = routeSkill("帮我做个计划", skills, enabled);
    expect(result.matchedSkills.some((s) => s.manifest.id === "task-planning")).toBe(true);
  });

  it("returns empty for unrelated input", () => {
    const result = routeSkill("今天天气不错", skills, enabled);
    expect(result.matchedSkills.filter((s) => s.manifest.id === "bug-fix")).toHaveLength(0);
  });

  it("skips disabled skills", () => {
    const enabledWithoutBugFix = new Set(["code-review", "task-planning"]);
    const result = routeSkill("帮我修复 bug", skills, enabledWithoutBugFix);
    expect(result.matchedSkills.some((s) => s.manifest.id === "bug-fix")).toBe(false);
  });

  it("provides match reasons", () => {
    const result = routeSkill("fix this bug", skills, enabled);
    const reasons = result.matchReasons.get("bug-fix");
    expect(reasons).toBeDefined();
    expect(reasons!.length).toBeGreaterThan(0);
  });
});
