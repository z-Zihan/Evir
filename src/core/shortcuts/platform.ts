export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
}

export type EvirPlatform = "macos" | "windows" | "web";

export function currentPlatform(): EvirPlatform {
  if (isMac()) return "macos";
  if (/Win/.test(globalThis.navigator?.platform ?? "")) return "windows";
  return "web";
}
