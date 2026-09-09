/**
 * Command-environment port (§23): surfaces the Rust-resolved tool
 * environment (login shell, resolved PATH, per-tool found/path/version) to
 * the Diagnostics UI for real-user troubleshooting — e.g. "why can't the
 * agent find pnpm". Browser runtimes have no tool subprocesses and report
 * null instead of pretending.
 */
export interface ToolProbeResult {
  name: string;
  found: boolean;
  path: string | null;
  version: string | null;
}

export interface CommandEnvironmentInfo {
  shell: string;
  resolvedPath: string;
  source: "login_shell" | "inherited" | "fallback";
  tools: ToolProbeResult[];
}

export interface CommandEnvironmentPort {
  describe(): Promise<CommandEnvironmentInfo | null>;
}

/** Browser/no-op adapter: no tool subprocesses exist outside the desktop. */
export class NullCommandEnvironment implements CommandEnvironmentPort {
  describe(): Promise<CommandEnvironmentInfo | null> {
    return Promise.resolve(null);
  }
}

/** Desktop adapter over the `command_environment_info` Tauri command. */
export class DesktopCommandEnvironment implements CommandEnvironmentPort {
  async describe(): Promise<CommandEnvironmentInfo | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CommandEnvironmentInfo>("command_environment_info");
  }
}
