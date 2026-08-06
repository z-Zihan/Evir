export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export type EvirPlatform = "macos" | "windows" | "web";

export function currentPlatform(): EvirPlatform {
  if (isMac()) return "macos";
  if (/Win/.test(navigator.platform)) return "windows";
  return "web";
}
