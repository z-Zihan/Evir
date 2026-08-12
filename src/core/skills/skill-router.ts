import type { InstalledSkill } from "./types";

export interface SkillRouteResult {
  matchedSkills: InstalledSkill[];
  matchReasons: Map<string, string[]>;
}

const DESCRIPTION_STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "into",
  "the",
  "this",
  "use",
  "using",
  "when",
  "with",
]);

interface ScoredSkill {
  skill: InstalledSkill;
  reasons: string[];
  score: number;
}

export interface SkillTriggerConflict {
  trigger: string;
  skillIds: string[];
}

function normalizeTrigger(trigger: string): string {
  return trigger.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function findSkillTriggerConflicts(
  skills: readonly InstalledSkill[],
): SkillTriggerConflict[] {
  const owners = new Map<string, Set<string>>();
  for (const skill of skills) {
    for (const trigger of skill.manifest.triggers ?? []) {
      const normalized = normalizeTrigger(trigger);
      const ids = owners.get(normalized) ?? new Set<string>();
      ids.add(skill.manifest.id);
      owners.set(normalized, ids);
    }
  }
  return [...owners.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([trigger, ids]) => ({ trigger, skillIds: [...ids].sort() }))
    .sort((a, b) => a.trigger.localeCompare(b.trigger));
}

function descriptionKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length >= 4 && !DESCRIPTION_STOP_WORDS.has(word));
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
  const scored: ScoredSkill[] = [];

  for (const skill of availableSkills) {
    if (!enabledSkillIds.has(skill.manifest.id)) continue;
    const skillReasons: string[] = [];
    let score = 0;
    const name = skill.manifest.name.toLowerCase();
    const desc = skill.manifest.description.toLowerCase();
    const id = skill.manifest.id.toLowerCase();

    // Match by skill id/name appearing in input
    if (input.includes(id) || input.includes(name)) {
      skillReasons.push(`input mentions "${skill.manifest.name}"`);
      score += 100;
    }

    for (const trigger of skill.manifest.triggers ?? []) {
      const normalizedTrigger = trigger.toLowerCase().trim();
      if (input.includes(normalizedTrigger)) {
        skillReasons.push(`input matches curated trigger "${trigger}"`);
        score += 20 + Math.min(normalizedTrigger.length, 20);
      }
    }

    // Imported skills may not have curated triggers. Description matches are deliberately
    // low-weight and exclude filler words so they cannot overwhelm explicit metadata.
    if ((skill.manifest.triggers?.length ?? 0) === 0) {
      const keywords = descriptionKeywords(desc);
      for (const kw of keywords) {
        if (input.includes(kw)) {
          skillReasons.push(`input matches keyword "${kw}"`);
          score += 1;
        }
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
        score += 10;
      }
    }

    if (skillReasons.length > 0) {
      scored.push({ skill, reasons: [...new Set(skillReasons)], score });
    }
  }

  scored.sort(
    (a, b) => b.score - a.score || a.skill.manifest.id.localeCompare(b.skill.manifest.id),
  );
  const selected = scored;
  return {
    matchedSkills: selected.map(({ skill }) => skill),
    matchReasons: new Map(selected.map(({ skill, reasons }) => [skill.manifest.id, reasons])),
  };
}
