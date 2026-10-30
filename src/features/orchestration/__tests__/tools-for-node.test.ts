import { describe, expect, it } from "vitest";
import type { PlanNode, ResourceScope } from "../../../core/orchestration/types";
import type { Capability, RiskLevel, ToolDefinition } from "../../../core/providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { toolsForNode } from "../orchestrated-run-state";

function tool(id: string, riskLevel: RiskLevel, requiredCapability?: Capability): ToolDefinition {
  return {
    id,
    name: id,
    description: id,
    source: "evir-local",
    riskLevel,
    ...(requiredCapability ? { requiredCapability } : {}),
    schema: {},
    execute: () => Promise.resolve({ success: true, output: "" }),
  };
}

const catalog: ToolDefinition[] = [
  tool("current_time", "L0"),
  tool("read_file", "L1", "filesystem"),
  tool("browser_open", "L1", "browserAutomation"),
  tool("git_commit", "L2", "git"),
  tool("write_file", "L3", "filesystem"),
  tool("run_command", "L3", "terminal"),
  tool("browser_click", "L2", "browserAutomation"),
  tool("uncapped_mutation", "L2"),
];

function runtimeWith(tools: ToolDefinition[] | undefined): EvirRuntime {
  return (tools === undefined
    ? {}
    : { toolRegistry: { list: () => tools } }) as unknown as EvirRuntime;
}

const readScope: ResourceScope = { kind: "workspace", value: ".", access: "read" };
const writeScope: ResourceScope = { kind: "path", value: "src", access: "write" };

function makeNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: "node-1",
    kind: "task",
    title: "Node",
    objective: "Do the thing",
    dependencies: [],
    requiredCapabilities: [],
    resourceScopes: [readScope],
    expectedArtifacts: [],
    successCriteria: [],
    status: "ready",
    ...overrides,
  };
}

const runtime = runtimeWith(catalog);

describe("toolsForNode", () => {
  it("read-only node keeps declared-capability L0/L1 tools but drops declared L2/L3", () => {
    const node = makeNode({ requiredCapabilities: ["filesystem", "git", "terminal"] });
    const ids = toolsForNode(node, runtime);
    expect(ids).toContain("read_file");
    expect(ids).toContain("current_time");
    expect(ids).not.toContain("git_commit");
    expect(ids).not.toContain("write_file");
    expect(ids).not.toContain("run_command");
  });

  it("read-only node keeps undeclared L1 tools and drops undeclared L2/L3", () => {
    const ids = toolsForNode(makeNode(), runtime);
    expect(ids).toContain("browser_open");
    expect(ids).toContain("read_file");
    expect(ids).not.toContain("browser_click");
    expect(ids).not.toContain("write_file");
  });

  it("write-scoped node includes declared L2/L3 tools and drops undeclared ones", () => {
    const node = makeNode({
      requiredCapabilities: ["filesystem", "git"],
      resourceScopes: [writeScope],
    });
    const ids = toolsForNode(node, runtime);
    expect(ids).toEqual(expect.arrayContaining(["git_commit", "write_file"]));
    expect(ids).not.toContain("run_command");
    expect(ids).not.toContain("browser_click");
  });

  it("verification node gets run_command without terminal capability or write scope", () => {
    const node = makeNode({ kind: "verification" });
    const ids = toolsForNode(node, runtime);
    expect(ids).toContain("run_command");
    // The carve-out is run_command only; other high-risk tools keep their boundary.
    expect(ids).not.toContain("write_file");
    expect(ids).not.toContain("uncapped_mutation");
  });

  it("non-verification node does not get run_command without terminal capability", () => {
    expect(toolsForNode(makeNode(), runtime)).not.toContain("run_command");
    expect(toolsForNode(makeNode({ resourceScopes: [writeScope] }), runtime)).not.toContain(
      "run_command",
    );
  });

  it("capability-free tools pass on any node unless the risk filter drops them", () => {
    expect(toolsForNode(makeNode(), runtime)).toContain("current_time");
    expect(toolsForNode(makeNode(), runtime)).not.toContain("uncapped_mutation");
    expect(toolsForNode(makeNode({ resourceScopes: [writeScope] }), runtime)).toContain(
      "uncapped_mutation",
    );
  });

  it("returns an empty list when the registry is missing or empty", () => {
    expect(toolsForNode(makeNode(), runtimeWith(undefined))).toEqual([]);
    expect(toolsForNode(makeNode(), runtimeWith([]))).toEqual([]);
  });

  it("treats a write scope anywhere in resourceScopes as a writing node", () => {
    const node = makeNode({
      requiredCapabilities: ["filesystem"],
      resourceScopes: [readScope, { kind: "git", value: "repo", access: "read" }, writeScope],
    });
    expect(toolsForNode(node, runtime)).toContain("write_file");
  });

  it("preserves registry order in the filtered result", () => {
    const node = makeNode({
      requiredCapabilities: ["filesystem", "git", "terminal", "browserAutomation"],
      resourceScopes: [writeScope],
    });
    expect(toolsForNode(node, runtime)).toEqual(catalog.map(({ id }) => id));
    expect(toolsForNode(makeNode(), runtime)).toEqual([
      "current_time",
      "read_file",
      "browser_open",
    ]);
  });
});
