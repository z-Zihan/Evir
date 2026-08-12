export const BUILTIN_SKILL_CATEGORIES = [
  "programming",
  "office-documents",
  "data",
  "git-devops",
  "security",
  "research",
  "information-gathering",
  "system-tools",
  "office-productivity",
  "developer-tools",
  "content-creation",
  "design",
  "legal",
  "finance-investing",
  "other",
] as const;

export type BuiltinSkillCategory = (typeof BUILTIN_SKILL_CATEGORIES)[number];

const CATEGORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidSkillCategory(category: string): boolean {
  return CATEGORY_ID_PATTERN.test(category);
}

export function normalizeCustomCategory(value: string): string {
  const input = value.trim();
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (normalized) return normalized;
  if (!input) return "other";

  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `custom-${(hash >>> 0).toString(36)}`;
}

export function customCategoryLocalizations(
  value: string,
): Partial<Record<"en" | "zh-CN", string>> | undefined {
  const label = value.trim();
  const category = normalizeCustomCategory(value);
  if (!label || BUILTIN_SKILL_CATEGORIES.some((builtin) => builtin === category)) return undefined;
  return { en: label, "zh-CN": label };
}
