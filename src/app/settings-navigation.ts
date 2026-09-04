import type { RuntimeTarget } from "../runtime/types";

export type SettingsTab =
  | "browser"
  | "providers"
  | "users"
  | "personalization"
  | "shortcuts"
  | "skills"
  | "mcp"
  | "usage"
  | "privacy"
  | "theme"
  | "language"
  | "memory"
  | "diagnostics"
  | "about";

const DESKTOP_ONLY_SETTINGS = new Set<SettingsTab>(["mcp", "browser"]);

export function isSettingsTabAvailable(tab: SettingsTab, target: RuntimeTarget): boolean {
  return target === "desktop" || !DESKTOP_ONLY_SETTINGS.has(tab);
}
