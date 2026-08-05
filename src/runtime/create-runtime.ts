import type { Capability, EvirRuntime, RuntimeTarget } from "./types";

function buildRuntime(target: RuntimeTarget, capabilities: Capability[]): EvirRuntime {
  const capabilitySet = new Set(capabilities);
  return {
    target,
    capabilities: capabilitySet,
    has: (capability) => capabilitySet.has(capability),
  };
}

export function createRuntime(): EvirRuntime {
  const target: RuntimeTarget = import.meta.env.VITE_EVIR_TARGET === "desktop" ? "desktop" : "web";

  if (target === "desktop") {
    return buildRuntime("desktop", [
      "chat",
      "attachments",
      "filesystem",
      "terminal",
      "git",
      "localMcp",
      "backgroundTasks",
    ]);
  }

  return buildRuntime("web", ["chat", "attachments"]);
}
