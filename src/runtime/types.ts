import type { DesktopStorageAdapter } from "./desktop-storage-adapter";

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
  storage?: DesktopStorageAdapter;
}
