import { createRuntime } from "./create-runtime";
import type { EvirRuntime } from "./types";

// Lazy: merely importing this module (transitively reachable from core
// helpers) must not construct the tool registry, harness, and workflow
// registries at load time.
let runtime: EvirRuntime | undefined;

function resolveRuntime(): EvirRuntime {
  if (!runtime) runtime = createRuntime();
  return runtime;
}

export function isNativeDesktopRuntime(): boolean {
  return resolveRuntime().target === "desktop" && "__TAURI_INTERNALS__" in globalThis;
}

export function getRuntime() {
  return resolveRuntime();
}

export const useRuntime = getRuntime;
