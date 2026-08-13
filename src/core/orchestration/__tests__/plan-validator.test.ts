import { describe, expect, it } from "vitest";
import { createPlan, createPlannedGraph } from "../planner";
import { validatePlanGraph, validatePlanRevision } from "../plan-validator";
import type { TaskBrief, WorkflowDefinition } from "../types";

function brief(overrides: Partial<TaskBrief> = {}): TaskBrief {
  const now = Date.now();
  return {
    id: "brief-1",
    runId: "run-1",
    conversationId: "conversation-1",
    goalKind: "change",
    objective: "Change a file",
    constraints: [],
    deliverables: ["changed file"],
    acceptanceCriteria: ["tests pass"],
    requiredCapabilities: ["filesystem"],
    assumptions: [],
    unknowns: [],
    risk: "medium",
    clarificationRound: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const context = {
  capabilities: new Set(["chat", "filesystem", "terminal", "git"] as const),
  workflowIds: new Set<string>(),
};

describe("plan validation", () => {
  it("accepts a generated plan with an approval boundary", () => {
    const plan = createPlan(brief(), "/workspace");
    expect(validatePlanGraph(plan, context)).toEqual({ valid: true, errors: [] });
    expect(plan.requiresConfirmation).toBe(true);
  });

  it("requires confirmation for high risk tasks", () => {
    expect(createPlan(brief({ risk: "high" }), "/workspace").status).toBe("awaiting_confirmation");
  });

  it("rejects cycles and missing approval boundaries", () => {
    const plan = createPlan(brief(), "/workspace");
    plan.nodes[0]!.dependencies = ["verify"];
    plan.nodes.find(({ id }) => id === "execute")!.requiresApproval = false;
    plan.nodes.find(({ id }) => id === "execute")!.dependencies = ["inspect"];
    const result = validatePlanGraph(plan, context);
    expect(result.errors).toContain("cyclic-plan");
    expect(result.errors).toContain("missing-approval-boundary:execute");
  });

  it("does not allow a running node to disappear in a revision", () => {
    const previous = createPlan(brief(), "/workspace");
    previous.nodes[0]!.status = "running";
    const next = { ...previous, revision: 2, nodes: previous.nodes.slice(1) };
    expect(validatePlanRevision(previous, next).errors).toContain("removed-running-node:inspect");
  });

  it("rejects plans whose dependency arrays disagree with their edges", () => {
    const plan = createPlan(brief(), "/workspace");
    plan.edges = plan.edges.filter(({ to }) => to !== "execute");
    expect(validatePlanGraph(plan, context).errors).toContain("dependency-edge-mismatch:execute");
  });

  it("does not accept requiresApproval without an explicit approval dependency", () => {
    const plan = createPlan(brief(), "/workspace");
    const execute = plan.nodes.find(({ id }) => id === "execute");
    if (!execute) throw new Error("Expected execute node");
    execute.dependencies = ["inspect"];
    plan.edges = plan.edges.map((edge) =>
      edge.to === "execute" ? { ...edge, from: "inspect" } : edge,
    );
    expect(validatePlanGraph(plan, context).errors).toContain("missing-approval-boundary:execute");
  });

  it("rejects built-in subgraph nesting deeper than three levels", () => {
    const workflow = (id: string, nested?: string): WorkflowDefinition => ({
      id,
      version: "1.0.0",
      title: id,
      nodes: [
        {
          kind: nested ? "subgraph" : "task",
          title: id,
          objective: id,
          dependencies: [],
          requiredCapabilities: [],
          resourceScopes: [],
          expectedArtifacts: [],
          successCriteria: [],
          ...(nested ? { subgraphId: nested } : {}),
        },
      ],
      edges: [],
    });
    const workflows = [
      workflow("one", "two"),
      workflow("two", "three"),
      workflow("three", "four"),
      workflow("four"),
    ];
    const plan = createPlan(brief({ goalKind: "answer", requiredCapabilities: [] }), null);
    plan.nodes[0] = {
      ...plan.nodes[0]!,
      kind: "subgraph",
      subgraphId: "one",
    };
    const result = validatePlanGraph(plan, {
      capabilities: context.capabilities,
      workflowIds: new Set(workflows.map(({ id }) => id)),
      workflows,
    });
    expect(result.errors).toContain("subgraph-depth-exceeded:respond");
  });

  it("rejects unknown fields in model-generated plan drafts", async () => {
    const plan = await createPlannedGraph(brief(), "/workspace", {
      generate: () =>
        Promise.resolve({
          nodes: [
            {
              id: "unsafe",
              kind: "task",
              title: "Unsafe draft",
              objective: "Bypass validation",
              dependencies: [],
              requiredCapabilities: [],
              resourceScopes: [],
              expectedArtifacts: [],
              successCriteria: [],
              hiddenReasoning: "must not cross the planner boundary",
            },
          ],
          edges: [],
        }),
    });

    expect(plan.nodes[0]?.id).toBe("inspect");
  });
});
