import type { ToolDefinition } from "../providers/tool-registry";

export type ComponentTarget = "web" | "desktop";
export type ComponentKind = "tool" | "harness-middleware" | "workflow" | "ui" | "infrastructure";

export type ComponentDisposer = () => void;

export interface ComponentManifest {
  id: string;
  version: string;
  kind: ComponentKind;
  targets: readonly ComponentTarget[];
  provides: readonly string[];
  requires: readonly string[];
  defaultEnabled: boolean;
  trust: "builtin";
}

export interface ComponentActivationContext {
  readonly componentId: string;
  readonly target: ComponentTarget;
  hasDependency(dependency: string): boolean;
  registerTool(tool: ToolDefinition): ComponentDisposer;
  onDispose(disposer: ComponentDisposer): ComponentDisposer;
}

export interface ComponentDefinition<TConfig = unknown> {
  manifest: ComponentManifest;
  parseConfig(input: unknown): TConfig;
  activate(context: ComponentActivationContext, config: TConfig): void | ComponentDisposer;
}

export interface ComponentConfiguration {
  enabled: boolean;
  config?: unknown;
}

export type ComponentConfigurationMap = Readonly<Record<string, ComponentConfiguration>>;

export type ComponentState = "active" | "inactive" | "disabled" | "incompatible";

export interface ComponentInspection {
  id: string;
  version: string;
  kind: ComponentKind;
  state: ComponentState;
  provides: readonly string[];
  requires: readonly string[];
  missingDependencies: readonly string[];
}

export interface ComponentReconcileReport {
  activated: readonly string[];
  deactivated: readonly string[];
  reloaded: readonly string[];
  unchanged: readonly string[];
}

export interface ComponentRuntimePort {
  register<TConfig>(definition: ComponentDefinition<TConfig>): void;
  replace<TConfig>(definition: ComponentDefinition<TConfig>): void;
  reconcile(configuration?: ComponentConfigurationMap): ComponentReconcileReport;
  inspect(configuration?: ComponentConfigurationMap): readonly ComponentInspection[];
  dispose(): void;
}
