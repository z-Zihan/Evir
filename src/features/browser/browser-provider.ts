/**
 * Agent browser provider selection: "evir" (the bundled CDP runtime, default)
 * or "ego-lite" (the external ego lite app driven through its `ego-browser`
 * CLI — experimental, macOS-only, user-installed).
 *
 * The choice is a profile-scoped preference (each Evir user can pick its own
 * provider) read synchronously so tool execution never constructs the app
 * runtime. Session isolation: the ego provider runs every operation inside a
 * task space named after the active profile (`evir-<profileId>`), so
 * concurrent profiles never share tabs or login contexts. Switching providers
 * never silently falls back: a missing ego setup surfaces as an explicit
 * tool error.
 */

import {
  getActiveProfileIdSync,
  readProfileScoped,
  writeProfileScoped,
} from "../../core/profile/profile-scope";

export type AgentBrowserProviderId = "evir" | "ego-lite";

const PROVIDER_KEY = "browser.agentProvider";

/** Evir browser command name → ego CLI operation. */
const EGO_OP_BY_COMMAND: Record<string, string> = {
  browser_open: "open",
  browser_navigate: "navigate",
  browser_history: "history",
  browser_snapshot: "snapshot",
  browser_screenshot: "screenshot",
  browser_click: "click",
  browser_fill: "fill",
  browser_press: "press",
  browser_scroll: "scroll",
  browser_get_text: "get_text",
  browser_url: "url",
  browser_tabs: "tabs",
  browser_switch_tab: "switch_tab",
  browser_close_tab: "close_tab",
  browser_wait: "wait",
};

/** Commands with no ego equivalent in v1 (explicit, never silently faked). */
export const EGO_UNSUPPORTED_COMMANDS = new Set<string>(["browser_select"]);

export function readAgentBrowserProvider(): AgentBrowserProviderId {
  try {
    return readProfileScoped(PROVIDER_KEY) === "ego-lite" ? "ego-lite" : "evir";
  } catch {
    return "evir";
  }
}

export function writeAgentBrowserProvider(provider: AgentBrowserProviderId): void {
  writeProfileScoped(PROVIDER_KEY, provider);
}

/** Task space naming keeps ego sessions profile-scoped (§68). */
export function egoTaskSpaceName(): string {
  const profile = getActiveProfileIdSync().replace(/[^a-zA-Z0-9_-]/g, "-");
  return `evir-${profile.slice(0, 40) || "default"}`;
}

/** Translate Evir command args into ego operation params. */
function egoParams(command: string, args?: Record<string, unknown>): Record<string, unknown> {
  const source = args ?? {};
  switch (command) {
    case "browser_click":
    case "browser_fill":
      return {
        ref: source.element_ref,
        ...(command === "browser_fill" ? { text: source.text } : {}),
      };
    case "browser_switch_tab":
    case "browser_close_tab":
      return { target_id: source.target_id };
    default:
      return source;
  }
}

/**
 * Route one Evir browser command to the active provider. Same signature as
 * tauriInvoke so browser-tools stays provider-agnostic.
 */
export async function invokeAgentBrowserCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { tauriInvoke } = await import("../../runtime/tauri-ipc");
  if (readAgentBrowserProvider() !== "ego-lite") {
    return tauriInvoke<T>(command, args);
  }
  if (EGO_UNSUPPORTED_COMMANDS.has(command)) {
    throw new Error(
      `${command} is not supported by the Ego Lite provider yet — use browser_fill or a fresh browser_snapshot`,
    );
  }
  const op = EGO_OP_BY_COMMAND[command];
  if (!op) {
    throw new Error(`${command} has no Ego Lite provider mapping`);
  }
  return tauriInvoke<T>("ego_browser_run", {
    op,
    params: egoParams(command, args),
    space: egoTaskSpaceName(),
  });
}
