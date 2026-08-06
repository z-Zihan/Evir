import { describe, expect, it, vi } from "vitest";
import type { Capability, RiskLevel, ToolDefinition } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import {
  TOOL_CAPABILITY_MISSING,
  TOOL_NOT_ALLOWED,
  TOOL_PERMISSION_REQUIRED,
  ToolExecutor,
  validateToolForExecution,
} from "../tool-executor";
import { createToolRegistry } from "../tool-registry-impl";

function runtime(
  mode: "ask" | "plan" | "agent",
  capabilities: Capability[] = [],
  target: "web" | "desktop" = "desktop",
): EvirRuntime {
  const capSet = new Set(capabilities);
  return {
    target,
    capabilities: capSet,
    has: (capability: Capability) => capSet.has(capability),
    mode,
  };
}

function tool(
  riskLevel: RiskLevel,
  requiredCapability?: Capability,
  execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" })),
): ToolDefinition {
  return {
    id: "test_tool",
    name: "test_tool",
    description: "Test tool",
    source: "evir-local",
    riskLevel,
    ...(requiredCapability ? { requiredCapability } : {}),
    schema: { type: "object" },
    execute,
  };
}

describe("tool enforcement", () => {
  it("blocks an L1 tool in ask mode", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L1", undefined, execute));

    const result = await new ToolExecutor(registry).execute("test_tool", {}, runtime("ask"));
    expect(result).toMatchObject({ success: false, error: TOOL_NOT_ALLOWED });
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows an L1 tool but blocks an L3 tool in plan mode", async () => {
    const l1Execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const l3Execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register({ ...tool("L1", undefined, l1Execute), id: "l1_tool", name: "l1_tool" });
    registry.register({ ...tool("L3", undefined, l3Execute), id: "l3_tool", name: "l3_tool" });

    const planRuntime = runtime("plan");
    const l1Result = await new ToolExecutor(registry).execute("l1_tool", {}, planRuntime);
    expect(l1Result).toMatchObject({ success: true });
    expect(l1Execute).toHaveBeenCalledOnce();

    const l3Result = await new ToolExecutor(registry).execute("l3_tool", {}, planRuntime);
    expect(l3Result).toMatchObject({ success: false, error: TOOL_NOT_ALLOWED });
    expect(l3Execute).not.toHaveBeenCalled();
  });

  it("allows an L3 tool in agent mode when approved", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L3", undefined, execute));

    const result = await new ToolExecutor(registry).execute(
      "test_tool",
      {},
      runtime("agent"),
      true,
    );
    expect(result).toMatchObject({ success: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("blocks an L3 tool in agent mode without approval", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L3", undefined, execute));

    const result = await new ToolExecutor(registry).execute("test_tool", {}, runtime("agent"));
    expect(result).toMatchObject({ success: false, error: TOOL_PERMISSION_REQUIRED });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks a tool requiring the filesystem capability on a Web runtime", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L1", "filesystem", execute));

    const webRuntime = runtime("agent", [], "web");
    const result = await new ToolExecutor(registry).execute("test_tool", {}, webRuntime);
    expect(result).toMatchObject({ success: false, error: TOOL_CAPABILITY_MISSING });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks a tool requiring the terminal capability on a Web runtime", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L3", "terminal", execute));

    const webRuntime = runtime("agent", [], "web");
    const result = await new ToolExecutor(registry).execute("test_tool", {}, webRuntime, true);
    expect(result).toMatchObject({ success: false, error: TOOL_CAPABILITY_MISSING });
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows a capability-gated tool once the runtime declares the capability", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L1", "filesystem", execute));

    const desktopRuntime = runtime("agent", ["filesystem"], "desktop");
    const result = await new ToolExecutor(registry).execute("test_tool", {}, desktopRuntime);
    expect(result).toMatchObject({ success: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  describe("validateToolForExecution", () => {
    it("returns null when a tool is fully permitted", () => {
      const t = tool("L1", "filesystem");
      const result = validateToolForExecution(t, "agent", runtime("agent", ["filesystem"]), false);
      expect(result).toBeNull();
    });

    it("checks risk level before capability before approval", () => {
      const t = tool("L4", "filesystem");
      expect(validateToolForExecution(t, "ask", runtime("ask"), true)).toBe(TOOL_NOT_ALLOWED);
      expect(validateToolForExecution(t, "agent", runtime("agent", [], "web"), true)).toBe(
        TOOL_CAPABILITY_MISSING,
      );
      expect(validateToolForExecution(t, "agent", runtime("agent", ["filesystem"]), false)).toBe(
        TOOL_PERMISSION_REQUIRED,
      );
    });
  });
});
