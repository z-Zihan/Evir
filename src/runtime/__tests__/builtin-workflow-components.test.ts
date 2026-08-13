import { describe, expect, it } from "vitest";
import { ComponentRuntime } from "../../core/components/component-runtime";
import { WorkflowRegistry } from "../../core/orchestration/workflow-registry";
import { createToolRegistry } from "../../core/tools/tool-registry-impl";
import { builtinWorkflowComponent } from "../components/builtin-workflow-components";

describe("builtin workflow component", () => {
  it("registers and removes the six trusted workflows with component lifecycle", () => {
    const workflowRegistry = new WorkflowRegistry();
    const runtime = new ComponentRuntime({
      target: "desktop",
      toolRegistry: createToolRegistry(),
      workflowRegistry,
      hostDependencies: ["service:workflow-registry"],
    });
    runtime.register(builtinWorkflowComponent);
    runtime.reconcile();
    expect(workflowRegistry.list().map(({ id }) => id)).toEqual([
      "inspect-plan-execute-verify",
      "research-synthesize",
      "change-test-diff",
      "parallel-read-join",
      "approval-action-verify",
      "failure-diagnose-retry-escalate",
    ]);

    runtime.reconcile({ "evir.workflows.builtin": { enabled: false } });
    expect(workflowRegistry.list()).toEqual([]);
  });
});
