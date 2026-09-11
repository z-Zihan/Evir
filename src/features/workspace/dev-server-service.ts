import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  invokeIdempotentWithRetry,
  invokeMutatingWithTimeout,
  parseCommandExecutionError,
} from "../../runtime/desktop-storage-adapter";
import { readTextFile, statFile } from "./workspace-services";
import { logger } from "../../core/logging/logger";

/**
 * Dev-server lifecycle service. Starting a dev server always follows
 * detect → show command → permission → start (§44): the UI displays the
 * exact program/args and the ask profile requires an explicit confirm.
 */

export type DevServerStatus = "starting" | "ready" | "running" | "stopped" | "crashed";

export interface DevServerState {
  projectId: string;
  cwd: string;
  program: string;
  args: string[];
  status: DevServerStatus;
  port: number | null;
  url: string | null;
  pid: number | null;
  startedAt: number;
  /** Process exit code once ended (None while running / signal-terminated). */
  exitCode: number | null;
  lastOutput: string[];
}

export interface DevScriptPlan {
  /** Executable to spawn (the package manager, so local binaries resolve). */
  program: string;
  args: string[];
  scriptName: string;
  /** Raw script command line, shown to the user before starting (§44). */
  command: string;
}

// Browser preview must prefer an explicitly browser-scoped script. A generic
// `dev` script may launch Electron/Tauri (including Evir itself), which cannot
// produce content for the embedded browser and can recursively open an app.
const SCRIPT_PRIORITY = [
  "dev:web",
  "dev:browser",
  "preview:web",
  "dev",
  "start",
  "preview",
  "serve",
];

/** Parse package.json (already read as text) into a dev-script plan. */
export function detectDevScriptFromPackageJson(source: string): DevScriptPlan | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  const scripts = (parsed as { scripts?: Record<string, unknown> }).scripts;
  if (!scripts || typeof scripts !== "object") return null;
  const scriptName = SCRIPT_PRIORITY.find((name) => typeof scripts[name] === "string");
  if (!scriptName) return null;
  const command = scripts[scriptName];
  if (typeof command !== "string" || command.trim() === "") return null;
  return {
    program: "npm",
    args: ["run", scriptName],
    scriptName,
    command: command.trim(),
  };
}

/** Pick the package manager binary from the project's lockfiles. */
export function packageManagerFor(lockfiles: readonly string[]): {
  program: string;
  runArgs: string[];
} {
  if (lockfiles.includes("pnpm-lock.yaml")) return { program: "pnpm", runArgs: ["run"] };
  if (lockfiles.includes("yarn.lock")) return { program: "yarn", runArgs: [] };
  return { program: "npm", runArgs: ["run"] };
}

/** Why detection produced no runnable plan — each needs different copy. */
export type DetectDevScriptResult =
  { plan: DevScriptPlan } | { reason: "inspect-failed" } | { reason: "no-script" };

/**
 * Detect the project's dev script. Failures are split (§C2/G4): an unreadable
 * package.json / IPC error is "inspect-failed" (Evir could not look), while a
 * parseable package.json without a matching script is "no-script" (the
 * project genuinely has none). Both used to collapse into null and render
 * the same misleading "no recognizable script" line.
 */
export async function detectDevScript(root: string): Promise<DetectDevScriptResult> {
  // §50 preview lifecycle trace: detect start/end (result only, no file body).
  logger.info("workspace", "dev-server.detect", { root });
  let source: string;
  try {
    source = await readTextFile(`${root}/package.json`);
  } catch {
    logger.info("workspace", "dev-server.detect-end", { root, result: "inspect-failed" });
    return { reason: "inspect-failed" };
  }
  const plan = detectDevScriptFromPackageJson(source);
  if (!plan) {
    logger.info("workspace", "dev-server.detect-end", { root, result: "no-script" });
    return { reason: "no-script" };
  }
  try {
    const lockfiles: string[] = [];
    for (const name of ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"]) {
      try {
        const stat = await statFile(`${root}/${name}`);
        // fs_file_stat reports a missing file as Ok({ exists: false }), not
        // a rejection — check the flag, or EVERY project resolves to pnpm
        // and the preview start fails on machines without a global pnpm.
        if ((stat as { exists?: boolean } | null)?.exists === true) lockfiles.push(name);
      } catch {
        // not present (runtimes that reject instead of statting)
      }
    }
    const manager = packageManagerFor(lockfiles);
    logger.info("workspace", "dev-server.detect-end", {
      root,
      result: "plan",
      script: plan.scriptName,
      program: manager.program,
    });
    return {
      plan: {
        ...plan,
        program: manager.program,
        args: [...manager.runArgs, plan.scriptName],
      },
    };
  } catch {
    logger.info("workspace", "dev-server.detect-end", { root, result: "inspect-failed" });
    return { reason: "inspect-failed" };
  }
}

// The custom-scheme IPC stall (tauri#7662, release macOS) can hang raw
// invokes for ~100s: start/stop get a timeout whose error says the outcome
// will be reconciled (status events + the list poll below), and the list
// poll — idempotent — gets the standard timeout+retry protection.

/** Structured start failure (§9/§11): distinct causes need distinct copy. */
export interface DevServerStartError {
  kind: "command_not_found" | "spawn_failed" | "outside_workspace" | "ipc_timeout" | "unknown";
  program: string | null;
  environmentSource: "login_shell" | "inherited" | "fallback" | null;
  message: string;
}

/** Parse a dev_server_start rejection into the classified failure. */
export function parseDevServerStartError(value: unknown): DevServerStartError {
  const structured = parseCommandExecutionError(value);
  if (structured) {
    return {
      kind: structured.kind,
      program: structured.program || null,
      environmentSource: structured.environmentSource,
      message: structured.message,
    };
  }
  const message = value instanceof Error ? value.message : String(value);
  if (message.includes("did not answer within")) {
    return { kind: "ipc_timeout", program: null, environmentSource: null, message };
  }
  return { kind: "unknown", program: null, environmentSource: null, message };
}

export function devServerStart(input: {
  projectId: string;
  cwd: string;
  program: string;
  args: string[];
  workspaceRoot: string;
}): Promise<DevServerState> {
  return invokeMutatingWithTimeout("dev_server_start", () => invoke("dev_server_start", input));
}

export function devServerStop(projectId: string): Promise<void> {
  return invokeMutatingWithTimeout("dev_server_stop", () =>
    invoke("dev_server_stop", { projectId }),
  );
}

export function devServerList(): Promise<DevServerState[]> {
  return invokeIdempotentWithRetry("dev_server_list", () => invoke("dev_server_list"));
}

export function subscribeDevServerStatus(
  handler: (state: DevServerState) => void,
): Promise<() => void> {
  return listen<DevServerState>("dev-server-status", (event) => {
    const state = event.payload;
    logger.info("workspace", "dev-server.status", {
      projectId: state.projectId,
      status: state.status,
      port: state.port,
      url: state.url,
      pid: state.pid,
      lastOutput: state.lastOutput,
    });
    handler(state);
  });
}
