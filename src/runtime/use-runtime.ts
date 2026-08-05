import { createRuntime } from "./create-runtime";

const runtime = createRuntime();

export function useRuntime() {
  return runtime;
}
