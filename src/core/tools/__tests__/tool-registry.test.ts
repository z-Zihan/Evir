import { describe, expect, it } from "vitest";
import type { RiskLevel, ToolDefinition, ToolSource } from "../../providers/tool-registry";
import { createToolRegistry } from "../tool-registry-impl";

function tool(id: string, riskLevel: RiskLevel, source: ToolSource = "evir-local"): ToolDefinition {
  return {
    id,
    name: id,
    description: id,
    source,
    riskLevel,
    schema: { type: "object" },
    execute: () => Promise.resolve({ success: true, output: id }),
  };
}

describe("ToolRegistryImpl", () => {
  it("registers, gets, lists, filters by source, and unregisters tools", () => {
    const registry = createToolRegistry();
    const local = tool("local", "L1");
    const remote = tool("remote", "L2", "mcp-remote");

    registry.register(local);
    registry.register(remote);
    expect(registry.get("local")).toBe(local);
    expect(registry.list()).toEqual([local, remote]);
    expect(registry.listBySource("mcp-remote")).toEqual([remote]);
    registry.unregister("local");
    expect(registry.get("local")).toBeUndefined();
  });

  it("filters tools using the L0 through L4 risk ordering", () => {
    const registry = createToolRegistry();
    for (const level of ["L0", "L1", "L2", "L3", "L4"] as const) {
      registry.register(tool(level, level));
    }

    expect(registry.listByRiskLevel("L2").map(({ id }) => id)).toEqual(["L0", "L1", "L2"]);
    expect(registry.listByRiskLevel("L4")).toHaveLength(5);
  });

  it("applies mode-specific risk limits", () => {
    const registry = createToolRegistry();
    for (const level of ["L0", "L1", "L2", "L3", "L4"] as const) {
      registry.register(tool(level, level));
    }

    expect(registry.listForMode("ask").map(({ id }) => id)).toEqual(["L0"]);
    expect(registry.listForMode("plan").map(({ id }) => id)).toEqual(["L0", "L1"]);
    expect(registry.listForMode("agent")).toHaveLength(5);
  });

  it("throws when a tool id is registered twice", () => {
    const registry = createToolRegistry();
    registry.register(tool("duplicate", "L0"));
    expect(() => registry.register(tool("duplicate", "L1"))).toThrow(/duplicate/);
  });
});
