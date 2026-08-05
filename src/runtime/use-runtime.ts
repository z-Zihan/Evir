import { createRuntime } from "./create-runtime";

const runtime = createRuntime();

export function getRuntime() {
  return runtime;
}

export const useRuntime = getRuntime;
