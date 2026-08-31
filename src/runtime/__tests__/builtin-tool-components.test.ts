import { describe, expect, it } from "vitest";
import { ComponentRuntime } from "../../core/components/component-runtime";
import { LOCAL_FILE_TOOLS } from "../../core/tools/builtin/local-file-tools";
import { BROWSER_TOOLS } from "../../core/tools/builtin/browser-tools";
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
    ],
  });
  for (const component of BUILTIN_TOOL_COMPONENTS) componentRuntime.register(component);
  componentRuntime.reconcile();
  return { componentRuntime, toolRegistry };
}

describe("built-in tool components", () => {
  it("preserves the complete Desktop tool set through component assembly", () => {
    const { componentRuntime, toolRegistry } = registerBuiltins("desktop");

    const expected = [...LOCAL_FILE_TOOLS, ...BROWSER_TOOLS].map(({ id }) => id).sort();
    expect(
      toolRegistry
        .list()
        .map(({ id }) => id)
        .sort(),
    ).toEqual(expected);
    expect(componentRuntime.inspect().every(({ state }) => state === "active")).toBe(true);
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

    expect(toolRegistry.list()).toEqual([]);
    expect(componentRuntime.inspect().every(({ state }) => state === "incompatible")).toBe(true);
  });
});
