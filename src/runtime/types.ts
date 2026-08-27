import type { DesktopStorageAdapter, SnapshotResult } from "./desktop-storage-adapter";
import type { PermissionContext } from "../core/security/permission-profiles";
import type { InteractionMode, ToolRegistry } from "../core/providers/tool-registry";
import type { ToolExecutor } from "../core/tools/tool-executor";
import type { StoragePort } from "../core/storage/storage-port";
import type { FileContextReference } from "../core/context/types";
import type { ComponentRuntimePort } from "../core/components/types";
import type { HarnessMiddlewareRegistryPort } from "../core/harness/types";
import type { WorkflowRegistryPort } from "../core/orchestration/workflow-registry";
import type { McpRuntimePort } from "../core/mcp/runtime-service";

export type RuntimeTarget = "web" | "desktop";

export type Capability =
  | "chat"
  | "attachments"
  | "filesystem"
  | "terminal"
  | "git"
  | "localMcp"
  | "browserAutomation"
  | "computerUse"
  | "backgroundTasks";

export interface AgentRunContext {
  id: string;
  snapshots: SnapshotResult[];
  fileReferences: FileContextReference[];
  /** UI mode that started the run (plan runs offer Execute Plan). */
  startedMode?: InteractionMode;
}

export interface EvirRuntime {
  target: RuntimeTarget;
  capabilities: ReadonlySet<Capability>;
  has(capability: Capability): boolean;
  getWorkspaceRoot?: () => string | null;
  selectWorkspaceDirectory?: () => Promise<string | null>;
  saveTextFile?: (contents: string, suggestedName: string) => Promise<string | null>;
  mode?: InteractionMode;
  /** Captured per-run; drives workspace/auto-approve policy for this run. */
  permissionContext?: PermissionContext | null;
  storage?: DesktopStorageAdapter;
  structuredStorage?: StoragePort;
  toolRegistry?: ToolRegistry;
  toolExecutor?: ToolExecutor;
  componentRuntime?: ComponentRuntimePort;
  harnessMiddlewareRegistry?: HarnessMiddlewareRegistryPort;
  workflowRegistry?: WorkflowRegistryPort;
  getMcpRuntime?: () => Promise<McpRuntimePort>;
  agentRun?: AgentRunContext;
}
