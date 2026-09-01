import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  startedAt: number | null;
  lastError: string | null;
}

export interface DevScriptPlan {
  /** Executable to spawn (the package manager, so local binaries resolve). */
  program: string;
  args: string[];
  scriptName: string;
  /** Raw script command line, shown to the user before starting (§44). */
  command: string;
}

const SCRIPT_PRIORITY = ["dev", "start", "preview", "serve"];

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

export async function detectDevScript(root: string): Promise<DevScriptPlan | null> {
  try {
    const source = await readTextFile(`${root}/package.json`);
    const plan = detectDevScriptFromPackageJson(source);
    if (!plan) return null;
    const lockfiles: string[] = [];
    for (const name of ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"]) {
      try {
        await statFile(`${root}/${name}`);
        lockfiles.push(name);
      } catch {
        // not present
      }
    }
    const manager = packageManagerFor(lockfiles);
    return {
      ...plan,
      program: manager.program,
      args: [...manager.runArgs, plan.scriptName],
    };
  } catch {
    return null;
  }
}

export function devServerStart(input: {
  projectId: string;
  cwd: string;
  program: string;
  args: string[];
  workspaceRoot: string;
}): Promise<DevServerState> {
  return invoke("dev_server_start", input);
}

export function devServerStop(projectId: string): Promise<void> {
  return invoke("dev_server_stop", { projectId });
}

export function devServerList(): Promise<DevServerState[]> {
  return invoke("dev_server_list");
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
      lastError: state.lastError,
    });
    handler(state);
  });
}
