import type { InstalledSkill } from "./types";
import type { InteractionMode, ToolDefinition, ToolRegistry } from "../providers/tool-registry";

export interface SkillValidationResult {
  skillId: string;
  valid: boolean;
  missingTools: string[];
}

export function validateSkillPermissions(
  skills: readonly InstalledSkill[],
  registry: ToolRegistry,
): SkillValidationResult[] {
  return skills.map((skill) => {
    const requiredTools = skill.manifest.permissions?.requiredTools ?? [];
    const missingTools = requiredTools.filter((toolId) => registry.get(toolId) === undefined);
    return {
      skillId: skill.manifest.id,
      valid: missingTools.length === 0,
      missingTools,
    };
  });
}

export function getActiveSkillTools(
  skills: readonly InstalledSkill[],
  registry: ToolRegistry,
  mode: InteractionMode,
): ToolDefinition[] {
  const allowedToolIds = new Set<string>();
  for (const skill of skills) {
    for (const toolId of skill.manifest.permissions?.requiredTools ?? []) {
      allowedToolIds.add(toolId);
    }
  }
  return registry.listForMode(mode).filter((tool) => allowedToolIds.has(tool.id));
}

// Characters that carry special meaning to a shell; a bare program name should never contain them.
const SHELL_METACHARACTERS = /[;&|`$<>(){}\\\n\r"'~*?!]/;

function hasShellMetacharacters(value: string): boolean {
  return SHELL_METACHARACTERS.test(value);
}

/**
 * Glob-style match where `*` stands for any sequence of characters, e.g.
 * segment "run *" matches "run test" but not "publish".
 */
function matchesGlob(pattern: string, value: string): boolean {
  const regexSource = pattern
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regexSource}$`).test(value.trim());
}

function splitProgramAndArgsPattern(pattern: string): { program: string; argsPattern: string } {
  const trimmed = pattern.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { program: trimmed, argsPattern: "" };
  return {
    program: trimmed.slice(0, spaceIndex),
    argsPattern: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * Matches program and args independently so a pattern like "npm *" binds `*`
 * only to the argument list, never letting arg content redefine the program.
 */
function matchesCommandPattern(pattern: string, program: string, args: readonly string[]): boolean {
  const { program: programPattern, argsPattern } = splitProgramAndArgsPattern(pattern);
  if (!matchesGlob(programPattern, program)) return false;
  return matchesGlob(argsPattern, args.join(" "));
}

export class SkillExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  validatePermissions(skills: readonly InstalledSkill[]): SkillValidationResult[] {
    return validateSkillPermissions(skills, this.registry);
  }

  getActiveTools(skills: readonly InstalledSkill[], mode: InteractionMode): ToolDefinition[] {
    return getActiveSkillTools(skills, this.registry, mode);
  }

  isCommandAllowed(skill: InstalledSkill, program: string, args: readonly string[]): boolean {
    if (hasShellMetacharacters(program)) return false;
    const allowedCommands = skill.manifest.permissions?.allowedCommands ?? [];
    if (allowedCommands.length === 0) return false;
    return allowedCommands.some((pattern) => matchesCommandPattern(pattern, program, args));
  }
}
