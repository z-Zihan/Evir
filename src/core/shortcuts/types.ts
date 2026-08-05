export type ShortcutScope = "app" | "global";
export type ShortcutPlatform = "all" | "macos" | "windows" | "web";

export interface ShortcutDefinition {
  id: string;
  labelKey: string;
  defaultAccelerator: string;
  scope: ShortcutScope;
  platforms: readonly ShortcutPlatform[];
  editable: boolean;
  enabledByDefault: boolean;
}

export interface ShortcutBinding {
  shortcutId: string;
  accelerator: string;
  enabled: boolean;
}
