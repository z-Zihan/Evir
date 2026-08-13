import { describe, expect, it, vi } from "vitest";
import type { RiskLevel, ToolDefinition } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { TOOL_PERMISSION_REQUIRED, ToolExecutor } from "../tool-executor";
import { createToolRegistry } from "../tool-registry-impl";

function runtime(mode: "ask" | "plan" | "agent"): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(),
    has: () => false,
    mode,
  };
}

function tool(
  riskLevel: RiskLevel,
  execute: ToolDefinition["execute"] = () => Promise.resolve({ success: true, output: "ok" }),
): ToolDefinition {
  return {
    id: "test_tool",
    name: "test_tool",
    description: "Test tool",
    source: "evir-local",
    riskLevel,
    schema: { type: "object" },
    execute,
  };
}

describe("ToolExecutor", () => {
  it("executes a registered tool", async () => {
    const registry = createToolRegistry();
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "done" }));
    registry.register(tool("L1", execute));

    await expect(
      new ToolExecutor(registry).execute("test_tool", {}, runtime("agent")),
    ).resolves.toEqual({
      success: true,
      output: "done",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("returns an error for an unknown tool", async () => {
    const result = await new ToolExecutor(createToolRegistry()).execute(
      "missing",
      {},
      runtime("agent"),
    );
    expect(result).toMatchObject({ success: false, error: "tool_not_found" });
  });

  it("requires permission instead of executing an L3 tool", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L3", execute));

    const result = await new ToolExecutor(registry).execute("test_tool", {}, runtime("agent"));
    expect(result).toEqual({
      success: false,
      output: "Permission required",
      error: TOOL_PERMISSION_REQUIRED,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks an L1 tool in ask mode", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "ok" }));
    const registry = createToolRegistry();
    registry.register(tool("L1", execute));

    const result = await new ToolExecutor(registry).execute("test_tool", {}, runtime("ask"));
    expect(result).toMatchObject({ success: false, error: "tool_not_allowed" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("propagates cancellation to the tool and active command adapter", async () => {
    const registry = createToolRegistry();
    const cancelActiveCommands = vi.fn(() => Promise.resolve());
    const execute = vi.fn(
      (_args: Record<string, unknown>, _runtime: EvirRuntime, signal?: AbortSignal) =>
        new Promise<{ success: true; output: string }>((resolve) => {
          signal?.addEventListener(
            "abort",
            () => resolve({ success: true, output: "late result" }),
            { once: true },
          );
        }),
    );
    registry.register(tool("L1", execute));
    const controller = new AbortController();
    const current: EvirRuntime = {
      ...runtime("agent"),
      storage: {
        cancelActiveCommands,
      } as unknown as NonNullable<EvirRuntime["storage"]>,
    };

    const pending = new ToolExecutor(registry).execute(
      "test_tool",
      {},
      current,
      false,
      controller.signal,
    );
    controller.abort();

    await expect(pending).resolves.toMatchObject({ success: false, error: "tool_cancelled" });
    expect(execute).toHaveBeenCalledWith({}, current, controller.signal);
    expect(cancelActiveCommands).toHaveBeenCalledOnce();
  });
});
