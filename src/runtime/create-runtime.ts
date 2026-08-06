import { desktopStorage } from "./desktop-storage-adapter";
import { LOCAL_FILE_TOOLS } from "../core/tools/builtin/local-file-tools";
import { ToolExecutor } from "../core/tools/tool-executor";
import { createToolRegistry } from "../core/tools/tool-registry-impl";
import type { Capability, EvirRuntime, RuntimeTarget } from "./types";

function buildRuntime(target: RuntimeTarget, capabilities: Capability[]): EvirRuntime {
  const capabilitySet = new Set(capabilities);
  return {
    target,
    capabilities: capabilitySet,
    has: (capability) => capabilitySet.has(capability),
  };
}

function getWorkspaceRoot(): string | null {
  const stored = localStorage.getItem("evir-workspace-current");
  return stored && stored.trim() ? stored : null;
}

export function createRuntime(): EvirRuntime {
  const target: RuntimeTarget = import.meta.env.VITE_EVIR_TARGET === "desktop" ? "desktop" : "web";
  const toolRegistry = createToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);

  if (target === "desktop") {
    for (const tool of LOCAL_FILE_TOOLS) toolRegistry.register(tool);
    const runtime = buildRuntime("desktop", [
      "chat",
      "attachments",
      "filesystem",
      "terminal",
      "git",
      "localMcp",
      "backgroundTasks",
    ]);
    return {
      ...runtime,
      storage: desktopStorage,
      toolRegistry,
      toolExecutor,
      mode: "agent" as const,
      getWorkspaceRoot,
    };
  }

  return {
    ...buildRuntime("web", ["chat", "attachments"]),
    toolRegistry,
    toolExecutor,
    mode: "ask" as const,
  };
}
