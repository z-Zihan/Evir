import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../../tools/tool-registry-impl";
import type { ToolDefinition } from "../../providers/tool-registry";
import { ComponentRuntime } from "../component-runtime";
import type { ComponentDefinition } from "../types";

function component(
  id: string,
  options: {
    provides?: string[];
    requires?: string[];
    version?: string;
    events?: string[];
    fail?: boolean;
    tool?: ToolDefinition;
  } = {},
): ComponentDefinition<null> {
  return {
    manifest: {
      id,
      version: options.version ?? "1.0.0",
      kind: options.tool ? "tool" : "infrastructure",
      targets: ["desktop"],
      provides: options.provides ?? [],
      requires: options.requires ?? [],
      defaultEnabled: true,
      trust: "builtin",
    },
    parseConfig(input) {
      if (input !== undefined && input !== null) throw new Error("unexpected config");
      return null;
    },
    activate(context) {
      options.events?.push(`activate:${id}:${options.version ?? "1.0.0"}`);
      if (options.tool) context.registerTool(options.tool);
      context.onDispose(() => options.events?.push(`dispose:${id}:${options.version ?? "1.0.0"}`));
      if (options.fail) throw new Error(`failed:${id}`);
    },
  };
}

function createDesktopRuntime() {
  const toolRegistry = createToolRegistry();
  return {
    toolRegistry,
    runtime: new ComponentRuntime({
      target: "desktop",
      toolRegistry,
      hostDependencies: ["capability:filesystem"],
    }),
  };
}

const testTool: ToolDefinition = {
  id: "test_tool",
  name: "test_tool",
  description: "test",
  source: "evir-local",
  riskLevel: "L1",
  schema: {},
  execute: () => Promise.resolve({ success: true, output: "ok" }),
};

describe("ComponentRuntime", () => {
  it("activates dependencies before consumers and disposes them in reverse order", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("consumer", { requires: ["service:provider"], events }));
    runtime.register(component("provider", { provides: ["service:provider"], events }));

    runtime.reconcile();
    runtime.dispose();

    expect(events).toEqual([
      "activate:provider:1.0.0",
      "activate:consumer:1.0.0",
      "dispose:consumer:1.0.0",
      "dispose:provider:1.0.0",
    ]);
  });

  it("registers and removes tool contributions through the effect scope", () => {
    const { runtime, toolRegistry } = createDesktopRuntime();
    runtime.register(
      component("filesystem-tools", {
        requires: ["capability:filesystem"],
        provides: ["tools:filesystem"],
        tool: testTool,
      }),
    );

    runtime.reconcile();
    expect(toolRegistry.get("test_tool")).toBe(testTool);

    runtime.reconcile({ "filesystem-tools": { enabled: false } });
    expect(toolRegistry.get("test_tool")).toBeUndefined();
  });

  it("reloads only a replaced component and its transitive dependents", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("provider", { provides: ["service:provider"], events }));
    runtime.register(component("consumer", { requires: ["service:provider"], events }));
    runtime.register(component("unrelated", { events }));
    runtime.reconcile();
    events.length = 0;

    runtime.replace(
      component("provider", {
        provides: ["service:provider"],
        version: "2.0.0",
        events,
      }),
    );
    const report = runtime.reconcile();

    expect([...report.reloaded].sort()).toEqual(["consumer", "provider"]);
    expect(report.unchanged).toEqual(["unrelated"]);
    expect(events).toEqual([
      "dispose:consumer:1.0.0",
      "dispose:provider:1.0.0",
      "activate:provider:2.0.0",
      "activate:consumer:1.0.0",
    ]);
  });

  it("restores the previous component graph when a replacement fails", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("provider", { provides: ["service:provider"], events }));
    runtime.register(component("consumer", { requires: ["service:provider"], events }));
    runtime.reconcile();
    events.length = 0;

    runtime.replace(
      component("provider", {
        provides: ["service:provider"],
        version: "2.0.0",
        events,
        fail: true,
      }),
    );

    expect(() => runtime.reconcile()).toThrow("failed:provider");
    expect(
      runtime
        .inspect()
        .filter(({ state }) => state === "active")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["consumer", "provider"]);
    expect(runtime.inspect().find(({ id }) => id === "provider")?.version).toBe("1.0.0");
    const retry = runtime.reconcile();
    expect(retry.reloaded).toEqual([]);
    expect(runtime.inspect().find(({ id }) => id === "provider")?.version).toBe("1.0.0");
    expect(events).toEqual([
      "dispose:consumer:1.0.0",
      "dispose:provider:1.0.0",
      "activate:provider:2.0.0",
      "dispose:provider:2.0.0",
      "activate:provider:1.0.0",
      "activate:consumer:1.0.0",
    ]);
  });

  it("restores the previous definition when replacement configuration parsing fails", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("provider", { events }));
    runtime.reconcile();
    events.length = 0;

    runtime.replace({
      ...component("provider", { version: "2.0.0", events }),
      parseConfig() {
        throw new Error("invalid replacement config");
      },
    });

    expect(() => runtime.reconcile()).toThrow("invalid replacement config");
    expect(runtime.inspect().find(({ id }) => id === "provider")?.version).toBe("1.0.0");
    expect(runtime.reconcile().reloaded).toEqual([]);
    expect(events).toEqual([]);
  });

  it("keeps components with missing dependencies inactive without disturbing active components", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("stable", { events }));
    runtime.reconcile();
    runtime.register(component("broken", { requires: ["service:missing"], events }));

    runtime.reconcile();
    expect(runtime.inspect().find(({ id }) => id === "stable")?.state).toBe("active");
    expect(runtime.inspect().find(({ id }) => id === "broken")).toMatchObject({
      state: "inactive",
      missingDependencies: ["service:missing"],
    });
    expect(events).toEqual(["activate:stable:1.0.0"]);
  });

  it("deactivates and reconnects dependents when a provider disappears and returns", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("provider", { provides: ["service:provider"], events }));
    runtime.register(component("consumer", { requires: ["service:provider"], events }));
    runtime.reconcile();
    events.length = 0;

    const disabled = runtime.reconcile({ provider: { enabled: false } });
    expect([...disabled.deactivated].sort()).toEqual(["consumer", "provider"]);
    expect(runtime.inspect().find(({ id }) => id === "consumer")?.state).toBe("inactive");

    const restored = runtime.reconcile({ provider: { enabled: true } });
    expect([...restored.activated].sort()).toEqual(["consumer", "provider"]);
    expect(events).toEqual([
      "dispose:consumer:1.0.0",
      "dispose:provider:1.0.0",
      "activate:provider:1.0.0",
      "activate:consumer:1.0.0",
    ]);
  });

  it("reloads a component when its parsed configuration changes", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    const configurable: ComponentDefinition<{ label: string }> = {
      manifest: {
        id: "configurable",
        version: "1.0.0",
        kind: "workflow",
        targets: ["desktop"],
        provides: [],
        requires: [],
        defaultEnabled: true,
        trust: "builtin",
      },
      parseConfig(input) {
        if (typeof input !== "object" || input === null || !("label" in input)) {
          throw new Error("label is required");
        }
        const label = input.label;
        if (typeof label !== "string") throw new Error("label must be a string");
        return { label };
      },
      activate(context, config) {
        events.push(`activate:${config.label}`);
        context.onDispose(() => events.push(`dispose:${config.label}`));
      },
    };
    runtime.register(configurable);
    runtime.reconcile({ configurable: { enabled: true, config: { label: "one" } } });

    const report = runtime.reconcile({
      configurable: { enabled: true, config: { label: "two" } },
    });

    expect(report.reloaded).toEqual(["configurable"]);
    expect(events).toEqual(["activate:one", "dispose:one", "activate:two"]);
  });

  it("continues deactivating the graph when one component disposer fails", () => {
    const events: string[] = [];
    const { runtime } = createDesktopRuntime();
    runtime.register(component("first", { events }));
    runtime.register({
      ...component("second", { events }),
      activate(context) {
        events.push("activate:second:1.0.0");
        context.onDispose(() => {
          events.push("dispose:second:1.0.0");
          throw new Error("dispose failed");
        });
      },
    });
    runtime.reconcile();

    expect(() => runtime.dispose()).toThrow("components could not be deactivated");
    expect(events).toEqual([
      "activate:first:1.0.0",
      "activate:second:1.0.0",
      "dispose:second:1.0.0",
      "dispose:first:1.0.0",
    ]);
  });
});
