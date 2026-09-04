import { create } from "zustand";

/**
 * Runtime contributions from installed + enabled plugins (§48). The plugin
 * system owns this store's contents — loading, enabling or disabling plugins
 * replaces the contributed set, so a disabled plugin's slash commands vanish
 * from the palette automatically. Consumers (slash palette, skill lists)
 * subscribe and render whatever is currently contributed; empty groups are
 * never shown.
 */

/** A slash command contributed by a plugin. Appears as `/id` in the palette. */
export interface PluginSlashCommand {
  pluginId: string;
  /** Command id without the leading slash, e.g. "translate". */
  id: string;
  description: string;
  /** Executed when the user selects the command from the slash palette. */
  run: () => void | Promise<void>;
}

interface PluginContributionState {
  slashCommands: PluginSlashCommand[];
  /** Replace the full contributed set (atomic enable/disable recompute). */
  replaceSlashCommands: (commands: PluginSlashCommand[]) => void;
}

export const usePluginContributionStore = create<PluginContributionState>((set) => ({
  slashCommands: [],
  replaceSlashCommands: (slashCommands) => set({ slashCommands }),
}));

/** Test/seam helper: contributions from a specific plugin. */
export function pluginSlashCommandsOf(pluginId: string): PluginSlashCommand[] {
  return usePluginContributionStore
    .getState()
    .slashCommands.filter((command) => command.pluginId === pluginId);
}
