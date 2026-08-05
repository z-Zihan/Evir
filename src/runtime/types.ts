import type { DesktopStorageAdapter } from "./desktop-storage-adapter";
import type { InteractionMode, ToolRegistry } from "../core/providers/tool-registry";
import type { ToolExecutor } from "../core/tools/tool-executor";

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

export interface EvirRuntime {
  target: RuntimeTarget;
  capabilities: ReadonlySet<Capability>;
  has(capability: Capability): boolean;
  mode?: InteractionMode;
  storage?: DesktopStorageAdapter;
  toolRegistry?: ToolRegistry;
  toolExecutor?: ToolExecutor;
}
