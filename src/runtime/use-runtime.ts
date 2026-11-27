import { createRuntime } from "./create-runtime";
import { loadComponentConfiguration } from "../features/settings/component-configuration";
import type { EvirRuntime } from "./types";

// Lazy: merely importing this module (transitively reachable from core
// helpers) must not construct the tool registry, harness, and workflow
// registries at load time.
let runtime: EvirRuntime | undefined;

function resolveRuntime(): EvirRuntime {
  if (!runtime) {
    runtime = createRuntime();
    // Component switches live in structured storage, so the runtime is built
    // first and the stored configuration is reconciled in once it loads. A
    // failed load must never block the app: defaults stay in effect.
    void loadComponentConfiguration()
      .then((configuration) => runtime?.componentRuntime?.reconcile(configuration))
      .catch(() => undefined);
  }
  return runtime;
}

export function isNativeDesktopRuntime(): boolean {
  return resolveRuntime().target === "desktop" && "__TAURI_INTERNALS__" in globalThis;
}

export function getRuntime() {
  return resolveRuntime();
}

export const useRuntime = getRuntime;
