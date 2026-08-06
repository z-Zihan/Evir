import type { InstalledSkill } from "./types";

export interface SkillRouteResult {
  matchedSkills: InstalledSkill[];
  matchReasons: Map<string, string[]>;
}

/**
 * Simple keyword-based skill router.
 * Matches user input against skill descriptions and names.
 */
export function routeSkill(
  userInput: string,
  availableSkills: InstalledSkill[],
  enabledSkillIds: Set<string>,
): SkillRouteResult {
  const input = userInput.toLowerCase();
  const matched: InstalledSkill[] = [];
  const reasons = new Map<string, string[]>();

  for (const skill of availableSkills) {
    if (!enabledSkillIds.has(skill.manifest.id)) continue;
    const skillReasons: string[] = [];
    const name = skill.manifest.name.toLowerCase();
    const desc = skill.manifest.description.toLowerCase();
    const id = skill.manifest.id.toLowerCase();

    // Match by skill id/name appearing in input
    if (input.includes(id) || input.includes(name)) {
      skillReasons.push(`input mentions "${skill.manifest.name}"`);
    }

    // Match by keywords in description
    const keywords = desc.split(/[\s,，。]+/).filter((w) => w.length > 2);
    for (const kw of keywords) {
      if (input.includes(kw)) {
        skillReasons.push(`input matches keyword "${kw}"`);
      }
    }

    // Match by specific patterns
    const patterns: Record<string, string[]> = {
      "bug-fix": ["bug", "fix", "error", "crash", "broken", "修复", "错误", "崩溃"],
      "code-review": ["review", "refactor", "quality", "审查", "重构", "质量"],
      "frontend-development": ["component", "ui", "css", "react", "前端", "组件", "样式"],
      "task-planning": ["plan", "task", "todo", "计划", "任务", "待办"],
      "skill-creator": ["skill", "create", "skill", "创建"],
    };

    const skillPatterns = patterns[skill.manifest.id] ?? [];
    for (const p of skillPatterns) {
      if (input.includes(p)) {
        skillReasons.push(`input matches pattern "${p}"`);
      }
    }

    if (skillReasons.length > 0) {
      matched.push(skill);
      reasons.set(skill.manifest.id, skillReasons);
    }
  }

  return { matchedSkills: matched, matchReasons: reasons };
}
