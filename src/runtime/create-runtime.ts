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
import { WorkflowRegistry } from "../core/orchestration/workflow-registry";
import { builtinWorkflowComponent } from "./components/builtin-workflow-components";
import { logger } from "../core/logging/logger";
import { getActiveWorkspaceRoot } from "../core/workspace/active-root";
import { createDesktopFileLogSink } from "./file-log-sink";

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
  return getActiveWorkspaceRoot();
}

async function selectWorkspaceDirectory(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

async function saveTextFile(contents: string, suggestedName: string): Promise<string | null> {
  const [{ save }, { writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const selected = await save({ defaultPath: suggestedName });
  if (!selected) return null;
  await writeTextFile(selected, contents);
  return selected;
}

export interface CreateRuntimeOptions {
  componentConfiguration?: ComponentConfigurationMap;
}

export function createRuntime(options: CreateRuntimeOptions = {}): EvirRuntime {
  const target: RuntimeTarget = import.meta.env.VITE_EVIR_TARGET === "desktop" ? "desktop" : "web";
  const toolRegistry = createToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);
  const harnessMiddlewareRegistry = new HarnessMiddlewareRegistry();
  const workflowRegistry = new WorkflowRegistry();
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
    workflowRegistry,
    hostDependencies: [
      ...capabilityDependencies(runtime.capabilities),
      "service:harness-middleware-registry",
      "service:workflow-registry",
    ],
  });
  for (const component of BUILTIN_TOOL_COMPONENTS) componentRuntime.register(component);
  registerBuiltinHarnessComponents(componentRuntime);
  componentRuntime.register(builtinWorkflowComponent);
  componentRuntime.reconcile(options.componentConfiguration);

  let mcpRuntimePromise: Promise<import("../core/mcp/runtime-service").McpRuntimePort> | undefined;
  const getMcpRuntime = () => {
    mcpRuntimePromise ??= Promise.all([
      import("../core/mcp/runtime-service"),
      import("../core/mcp/mcp-repository"),
    ]).then(([{ McpRuntimeService }, { McpServerRepository }]) => {
      const mcpStorage =
        target === "desktop" && "__TAURI_INTERNALS__" in globalThis
          ? desktopStructuredStorage
          : runtime.structuredStorage!;
      return new McpRuntimeService(
        componentRuntime,
        options.componentConfiguration,
        undefined,
        new McpServerRepository(mcpStorage),
      );
    });
    return mcpRuntimePromise;
  };

  if (target === "desktop") {
    if ("__TAURI_INTERNALS__" in globalThis) {
      void createDesktopFileLogSink().then(
        (sink) => logger.attachSink(sink),
        (error: unknown) => {
          logger.warn("app", "app.log-persistence-unavailable", {
            errorType: error instanceof Error ? error.name : "Error",
          });
        },
      );
    }
    logger.info("app", "app.session-started", { target, capabilities: [...runtime.capabilities] });
    return {
      ...runtime,
      storage: desktopStorage,
      structuredStorage:
        "__TAURI_INTERNALS__" in globalThis ? desktopStructuredStorage : new IndexedDBAdapter(),
      toolRegistry,
      toolExecutor,
      componentRuntime,
      harnessMiddlewareRegistry,
      workflowRegistry,
      getMcpRuntime,
      mode: "agent" as const,
      getWorkspaceRoot,
      selectWorkspaceDirectory,
      saveTextFile,
    };
  }

  return {
    ...runtime,
    toolRegistry,
    toolExecutor,
    componentRuntime,
    harnessMiddlewareRegistry,
    workflowRegistry,
    mode: "ask" as const,
  };
}
