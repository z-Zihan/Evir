import { describe, expect, it } from "vitest";
import { ComponentRuntime } from "../../core/components/component-runtime";
import { LOCAL_FILE_TOOLS } from "../../core/tools/builtin/local-file-tools";
import { BROWSER_TOOLS } from "../../core/tools/builtin/browser-tools";
import { CANVAS_TOOLS } from "../../core/tools/builtin/canvas-tools";
import { KNOWLEDGE_TOOLS } from "../../core/tools/builtin/knowledge-tools";
import { COMPUTER_TOOLS } from "../../core/tools/builtin/computer-tools";
import { createToolRegistry } from "../../core/tools/tool-registry-impl";
import { BUILTIN_TOOL_COMPONENTS } from "../components/builtin-tool-components";

function registerBuiltins(target: "web" | "desktop") {
  const toolRegistry = createToolRegistry();
  const componentRuntime = new ComponentRuntime({
    target,
    toolRegistry,
    hostDependencies: [
      "capability:filesystem",
      "capability:terminal",
      "capability:git",
      "capability:browserAutomation",
      "capability:computerUse",
    ],
  });
  for (const component of BUILTIN_TOOL_COMPONENTS) componentRuntime.register(component);
  componentRuntime.reconcile();
  return { componentRuntime, toolRegistry };
}

describe("built-in tool components", () => {
  it("preserves the complete Desktop tool set through component assembly", () => {
    const { componentRuntime, toolRegistry } = registerBuiltins("desktop");

    const expected = [...LOCAL_FILE_TOOLS, ...CANVAS_TOOLS, ...BROWSER_TOOLS, ...KNOWLEDGE_TOOLS]
      .map(({ id }) => id)
      .sort();
    expect(
      toolRegistry
        .list()
        .map(({ id }) => id)
        .sort(),
    ).toEqual(expected);
    // Computer use ships opt-in: its component is present but disabled until
    // the user turns it on, so its tools are not registered by default.
    const states = componentRuntime.inspect();
    expect(
      states
        .filter(({ id }) => id !== "evir.tools.computer-use")
        .every(({ state }) => state === "active"),
    ).toBe(true);
    expect(states.find(({ id }) => id === "evir.tools.computer-use")?.state).toBe("disabled");
    expect(toolRegistry.list().some(({ id }) => id.startsWith("computer_"))).toBe(false);
  });

  it("registers the computer-use tools only when the opt-in component is enabled", () => {
    const { componentRuntime, toolRegistry } = registerBuiltins("desktop");

    componentRuntime.reconcile({ "evir.tools.computer-use": { enabled: true } });

    const registered = toolRegistry
      .list()
      .filter(({ requiredCapability }) => requiredCapability === "computerUse")
      .map(({ id }) => id)
      .sort();
    expect(registered).toEqual(COMPUTER_TOOLS.map(({ id }) => id).sort());
    for (const tool of COMPUTER_TOOLS) {
      expect(tool.requiredCapability).toBe("computerUse");
    }
    // Desktop control is L3 (needs the approval conversation); reading the
    // screen is L1, in line with the browser screenshot tool.
    expect(toolRegistry.get("computer_click")?.riskLevel).toBe("L3");
    expect(toolRegistry.get("computer_screenshot")?.riskLevel).toBe("L1");
  });

  it("can disable one capability group without rebuilding unrelated tools", () => {
    const { componentRuntime, toolRegistry } = registerBuiltins("desktop");

    const report = componentRuntime.reconcile({
      "evir.tools.terminal": { enabled: false },
    });

    expect(report.deactivated).toEqual(["evir.tools.terminal"]);
    expect(toolRegistry.get("run_command")).toBeUndefined();
    expect(toolRegistry.get("read_file")).toBeDefined();
    expect(toolRegistry.get("git_status")).toBeDefined();
    expect(toolRegistry.get("browser_snapshot")).toBeDefined();
  });

  it("keeps Desktop-only components inactive in the Web runtime", () => {
    const { componentRuntime, toolRegistry } = registerBuiltins("web");

    // The knowledge index lives in the shared entity store, so its tool
    // stays active on web; every FS/terminal/browser component stays off.
    expect(toolRegistry.list().map(({ id }) => id)).toEqual(KNOWLEDGE_TOOLS.map(({ id }) => id));
    expect(
      componentRuntime
        .inspect()
        .filter(({ id }) => id !== "evir.tools.knowledge")
        .every(({ state }) => state === "incompatible"),
    ).toBe(true);
  });
});
