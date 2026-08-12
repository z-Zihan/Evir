import type { ToolRegistry } from "../providers/tool-registry";
import { EffectScope } from "./effect-scope";
import type {
  ComponentActivationContext,
  ComponentConfigurationMap,
  ComponentDefinition,
  ComponentInspection,
  ComponentManifest,
  ComponentReconcileReport,
  ComponentRuntimePort,
  ComponentTarget,
} from "./types";

interface RegisteredDefinition {
  manifest: ComponentManifest;
  parseConfig(input: unknown): unknown;
  activate(context: ComponentActivationContext, config: unknown): void | (() => void);
}

interface DesiredComponent {
  definition: RegisteredDefinition;
  config: unknown;
  fingerprint: string;
}

interface ActiveComponent extends DesiredComponent {
  scope: EffectScope;
}

export interface ComponentRuntimeOptions {
  target: ComponentTarget;
  toolRegistry: ToolRegistry;
  hostDependencies?: readonly string[];
}

function eraseConfig<TConfig>(definition: ComponentDefinition<TConfig>): RegisteredDefinition {
  return {
    manifest: definition.manifest,
    parseConfig: (input) => definition.parseConfig(input),
    activate: (context, config) => definition.activate(context, config as TConfig),
  };
}

function validateManifest(manifest: ComponentManifest): void {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(manifest.id)) {
    throw new Error(`Invalid component id: ${manifest.id}`);
  }
  if (!manifest.version.trim()) throw new Error(`Component ${manifest.id} has no version`);
  if (new Set(manifest.provides).size !== manifest.provides.length) {
    throw new Error(`Component ${manifest.id} declares duplicate provided dependencies`);
  }
  if (new Set(manifest.requires).size !== manifest.requires.length) {
    throw new Error(`Component ${manifest.id} declares duplicate required dependencies`);
  }
}

function fingerprint(config: unknown): string {
  const serialized = JSON.stringify(config);
  if (serialized === undefined)
    throw new Error("Component configuration must be JSON-serializable");
  return serialized;
}

function dependencyProviders(components: readonly DesiredComponent[]): Map<string, string> {
  const providers = new Map<string, string>();
  for (const component of components) {
    for (const dependency of component.definition.manifest.provides) {
      const existing = providers.get(dependency);
      if (existing) {
        throw new Error(
          `Dependency ${dependency} is provided by both ${existing} and ${component.definition.manifest.id}`,
        );
      }
      providers.set(dependency, component.definition.manifest.id);
    }
  }
  return providers;
}

function componentDependents(components: readonly DesiredComponent[]): Map<string, Set<string>> {
  const providers = dependencyProviders(components);
  const dependents = new Map<string, Set<string>>();
  for (const component of components) {
    for (const requirement of component.definition.manifest.requires) {
      const provider = providers.get(requirement);
      if (!provider) continue;
      const ids = dependents.get(provider) ?? new Set<string>();
      ids.add(component.definition.manifest.id);
      dependents.set(provider, ids);
    }
  }
  return dependents;
}

function expandAffected(
  initial: Set<string>,
  graphs: readonly Map<string, Set<string>>[],
): Set<string> {
  const affected = new Set(initial);
  const queue = [...initial];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    for (const graph of graphs) {
      for (const dependent of graph.get(id) ?? []) {
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return affected;
}

export class ComponentRuntime implements ComponentRuntimePort {
  private readonly definitions = new Map<string, RegisteredDefinition>();
  private readonly replacementFallbacks = new Map<string, RegisteredDefinition>();
  private readonly active = new Map<string, ActiveComponent>();
  private activationOrder: string[] = [];
  private lastConfiguration: ComponentConfigurationMap = {};
  private readonly target: ComponentTarget;
  private readonly toolRegistry: ToolRegistry;
  private readonly hostDependencies: ReadonlySet<string>;

  constructor(options: ComponentRuntimeOptions) {
    this.target = options.target;
    this.toolRegistry = options.toolRegistry;
    this.hostDependencies = new Set(options.hostDependencies ?? []);
  }

  register<TConfig>(definition: ComponentDefinition<TConfig>): void {
    validateManifest(definition.manifest);
    if (this.definitions.has(definition.manifest.id)) {
      throw new Error(`Component already registered: ${definition.manifest.id}`);
    }
    this.definitions.set(definition.manifest.id, eraseConfig(definition));
  }

  replace<TConfig>(definition: ComponentDefinition<TConfig>): void {
    validateManifest(definition.manifest);
    if (!this.definitions.has(definition.manifest.id)) {
      throw new Error(`Cannot replace unknown component: ${definition.manifest.id}`);
    }
    if (!this.replacementFallbacks.has(definition.manifest.id)) {
      const current = this.definitions.get(definition.manifest.id);
      if (current) this.replacementFallbacks.set(definition.manifest.id, current);
    }
    this.definitions.set(definition.manifest.id, eraseConfig(definition));
  }

  reconcile(
    configuration: ComponentConfigurationMap = this.lastConfiguration,
  ): ComponentReconcileReport {
    let desired: DesiredComponent[];
    try {
      desired = this.resolveDesired(configuration);
    } catch (error) {
      this.restoreReplacedDefinitions(new Set(this.replacementFallbacks.keys()));
      throw error;
    }
    const desiredById = new Map(
      desired.map((component) => [component.definition.manifest.id, component]),
    );
    const current = this.activationOrder
      .map((id) => this.active.get(id))
      .filter((component): component is ActiveComponent => component !== undefined);
    const currentById = new Map(
      current.map((component) => [component.definition.manifest.id, component]),
    );
    const changed = new Set<string>();
    for (const id of new Set([...currentById.keys(), ...desiredById.keys()])) {
      const previous = currentById.get(id);
      const next = desiredById.get(id);
      if (!previous || !next || previous.definition !== next.definition) changed.add(id);
      else if (previous.fingerprint !== next.fingerprint) changed.add(id);
    }
    const affected = expandAffected(changed, [
      componentDependents(current),
      componentDependents(desired),
    ]);
    const previousAffected = current.filter((component) =>
      affected.has(component.definition.manifest.id),
    );

    try {
      this.deactivateAffected(affected);
      for (const component of desired) {
        const id = component.definition.manifest.id;
        if (affected.has(id)) this.activate(component);
      }
    } catch (error) {
      this.restoreReplacedDefinitions(affected);
      this.rollback(affected, previousAffected, error);
    }

    for (const id of affected) this.replacementFallbacks.delete(id);

    this.lastConfiguration = configuration;
    const previousIds = new Set(currentById.keys());
    const desiredIds = new Set(desiredById.keys());
    return {
      activated: [...desiredIds].filter((id) => !previousIds.has(id)),
      deactivated: [...previousIds].filter((id) => !desiredIds.has(id)),
      reloaded: [...affected].filter((id) => previousIds.has(id) && desiredIds.has(id)),
      unchanged: [...desiredIds].filter((id) => !affected.has(id)),
    };
  }

  inspect(
    configuration: ComponentConfigurationMap = this.lastConfiguration,
  ): ComponentInspection[] {
    return [...this.definitions.values()].map(({ manifest }) => {
      const active = this.active.get(manifest.id);
      const compatible = manifest.targets.includes(this.target);
      const enabled = configuration[manifest.id]?.enabled ?? manifest.defaultEnabled;
      const state = active
        ? "active"
        : !compatible
          ? "incompatible"
          : enabled
            ? "inactive"
            : "disabled";
      return {
        id: manifest.id,
        version: active?.definition.manifest.version ?? manifest.version,
        kind: manifest.kind,
        state,
        provides: manifest.provides,
        requires: manifest.requires,
        missingDependencies: manifest.requires.filter(
          (dependency) => !this.hasActiveDependency(dependency),
        ),
      };
    });
  }

  dispose(): void {
    this.deactivateAffected(new Set(this.activationOrder));
    this.lastConfiguration = {};
  }

  private resolveDesired(configuration: ComponentConfigurationMap): DesiredComponent[] {
    const candidates: DesiredComponent[] = [];
    for (const definition of this.definitions.values()) {
      const { manifest } = definition;
      const enabled = configuration[manifest.id]?.enabled ?? manifest.defaultEnabled;
      if (!enabled || !manifest.targets.includes(this.target)) continue;
      const config = definition.parseConfig(configuration[manifest.id]?.config);
      candidates.push({ definition, config, fingerprint: fingerprint(config) });
    }
    const providers = dependencyProviders(candidates);
    for (const dependency of this.hostDependencies) {
      if (providers.has(dependency)) {
        throw new Error(`Component cannot replace host dependency: ${dependency}`);
      }
    }
    const ordered: DesiredComponent[] = [];
    const available = new Set(this.hostDependencies);
    const remaining = new Map(
      candidates.map((component) => [component.definition.manifest.id, component]),
    );
    while (remaining.size > 0) {
      const ready = [...remaining.values()].filter((component) =>
        component.definition.manifest.requires.every((dependency) => available.has(dependency)),
      );
      if (ready.length === 0) {
        break;
      }
      for (const component of ready) {
        ordered.push(component);
        remaining.delete(component.definition.manifest.id);
        for (const dependency of component.definition.manifest.provides) {
          available.add(dependency);
        }
      }
    }
    return ordered;
  }

  private activate(component: DesiredComponent): void {
    const { definition } = component;
    const id = definition.manifest.id;
    const scope = new EffectScope();
    const context: ComponentActivationContext = {
      componentId: id,
      target: this.target,
      hasDependency: (dependency) => this.hasActiveDependency(dependency),
      registerTool: (tool) => {
        this.toolRegistry.register(tool);
        return scope.add(() => this.toolRegistry.unregister(tool.id));
      },
      onDispose: (disposer) => scope.add(disposer),
    };
    try {
      const disposer = definition.activate(context, component.config);
      if (disposer) scope.add(disposer);
    } catch (error) {
      try {
        scope.dispose();
      } catch (disposeError) {
        throw new AggregateError([error, disposeError], `Component ${id} activation failed`);
      }
      throw error;
    }
    this.active.set(id, { ...component, scope });
    this.activationOrder.push(id);
  }

  private deactivateAffected(affected: ReadonlySet<string>): void {
    const errors: unknown[] = [];
    for (const id of [...this.activationOrder].reverse()) {
      if (!affected.has(id)) continue;
      const component = this.active.get(id);
      this.active.delete(id);
      this.activationOrder = this.activationOrder.filter((activeId) => activeId !== id);
      try {
        component?.scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more components could not be deactivated");
    }
  }

  private rollback(
    affected: ReadonlySet<string>,
    previous: readonly ActiveComponent[],
    originalError: unknown,
  ): never {
    const rollbackErrors: unknown[] = [];
    try {
      this.deactivateAffected(affected);
    } catch (error) {
      rollbackErrors.push(error);
    }
    for (const component of previous) {
      try {
        this.activate(component);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [originalError, ...rollbackErrors],
        "Component reconciliation and rollback both failed",
      );
    }
    throw originalError;
  }

  private restoreReplacedDefinitions(affected: ReadonlySet<string>): void {
    for (const id of affected) {
      const fallback = this.replacementFallbacks.get(id);
      if (!fallback) continue;
      this.definitions.set(id, fallback);
      this.replacementFallbacks.delete(id);
    }
  }

  private hasActiveDependency(dependency: string): boolean {
    if (this.hostDependencies.has(dependency)) return true;
    return [...this.active.values()].some(({ definition }) =>
      definition.manifest.provides.includes(dependency),
    );
  }
}
