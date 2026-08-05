import type { ShortcutBinding, ShortcutDefinition, ShortcutScope } from "./types";

export interface ShortcutRegistry {
  list(): readonly ShortcutDefinition[];
  get(id: string): ShortcutDefinition | undefined;
  getBinding(shortcutId: string): ShortcutBinding | undefined;
  setBinding(shortcutId: string, accelerator: string): void;
  resetBinding(shortcutId: string): void;
  checkConflict(accelerator: string, scope: ShortcutScope): string | undefined;
}
