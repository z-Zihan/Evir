import { desktopStorage, desktopStructuredStorage } from "./desktop-storage-adapter";
import { IndexedDBAdapter } from "../core/storage/indexed-db-adapter";
import { ToolExecutor } from "../core/tools/tool-executor";
import { createToolRegistry } from "../core/tools/tool-registry-impl";
import { ComponentRuntime } from "../core/components/component-runtime";
import { HarnessMiddlewareRegistry } from "../core/harness/middleware-registry";
import type { ComponentConfigurationMap } from "../core/components/types";
import {
  BUILTIN_TOOL_COMPONENTS,
  capabilityDependencies,
} from "./components/builtin-tool-components";
import {
  createProtectedToolPolicyMiddleware,
  registerBuiltinHarnessComponents,
} from "./components/builtin-harness-components";
import type { Capability, EvirRuntime, RuntimeTarget } from "./types";

function buildRuntime(target: RuntimeTarget, capabilities: Capability[]): EvirRuntime {
  const capabilitySet = new Set(capabilities);
  return {
    target,
    capabilities: capabilitySet,
    has: (capability) => capabilitySet.has(capability),
    structuredStorage: new IndexedDBAdapter(),
  };
}

function getWorkspaceRoot(): string | null {
  const stored = localStorage.getItem("evir-workspace-current");
  return stored && stored.trim() ? stored : null;
}

async function selectWorkspaceDirectory(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export interface CreateRuntimeOptions {
  componentConfiguration?: ComponentConfigurationMap;
}

export function createRuntime(options: CreateRuntimeOptions = {}): EvirRuntime {
  const target: RuntimeTarget = import.meta.env.VITE_EVIR_TARGET === "desktop" ? "desktop" : "web";
  const toolRegistry = createToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);
  const harnessMiddlewareRegistry = new HarnessMiddlewareRegistry();
  harnessMiddlewareRegistry.registerProtected(
    createProtectedToolPolicyMiddleware(),
    "evir.host.tool-policy",
  );
  const capabilities: Capability[] =
    target === "desktop"
      ? ["chat", "attachments", "filesystem", "terminal", "git", "localMcp", "backgroundTasks"]
      : ["chat", "attachments"];
  const runtime = buildRuntime(target, capabilities);
  const componentRuntime = new ComponentRuntime({
    target,
    toolRegistry,
    harnessMiddlewareRegistry,
    hostDependencies: [
      ...capabilityDependencies(runtime.capabilities),
      "service:harness-middleware-registry",
    ],
  });
  for (const component of BUILTIN_TOOL_COMPONENTS) componentRuntime.register(component);
  registerBuiltinHarnessComponents(componentRuntime);
  componentRuntime.reconcile(options.componentConfiguration);

  if (target === "desktop") {
    return {
      ...runtime,
      storage: desktopStorage,
      structuredStorage:
        "__TAURI_INTERNALS__" in globalThis ? desktopStructuredStorage : new IndexedDBAdapter(),
      toolRegistry,
      toolExecutor,
      componentRuntime,
      harnessMiddlewareRegistry,
      mode: "agent" as const,
      getWorkspaceRoot,
      selectWorkspaceDirectory,
    };
  }

  return {
    ...runtime,
    toolRegistry,
    toolExecutor,
    componentRuntime,
    harnessMiddlewareRegistry,
    mode: "ask" as const,
  };
}
