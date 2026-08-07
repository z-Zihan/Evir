import { createRuntime } from "./create-runtime";

const runtime = createRuntime();

export function isNativeDesktopRuntime(): boolean {
  return runtime.target === "desktop" && "__TAURI_INTERNALS__" in globalThis;
}

export function getRuntime() {
  return runtime;
}

export const useRuntime = getRuntime;
