import type { WorkflowDefinition } from "./types";

export interface WorkflowRegistryPort {
  register(workflow: WorkflowDefinition): () => void;
  get(id: string): WorkflowDefinition | undefined;
  list(): readonly WorkflowDefinition[];
}

export class WorkflowRegistry implements WorkflowRegistryPort {
  private readonly workflows = new Map<string, WorkflowDefinition>();

  register(workflow: WorkflowDefinition): () => void {
    if (this.workflows.has(workflow.id))
      throw new Error(`Workflow already registered: ${workflow.id}`);
    this.workflows.set(workflow.id, workflow);
    return () => this.workflows.delete(workflow.id);
  }

  get(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  list(): readonly WorkflowDefinition[] {
    return [...this.workflows.values()];
  }
}

function step(
  title: string,
  objective: string,
  kind: WorkflowDefinition["nodes"][number]["kind"] = "task",
) {
  return {
    kind,
    title,
    objective,
    dependencies: [],
    requiredCapabilities: [],
    resourceScopes: [],
    expectedArtifacts: [],
    successCriteria: [],
  };
}

export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    id: "inspect-plan-execute-verify",
    version: "1.0.0",
    title: "Inspect, plan, execute, verify",
    nodes: [
      step("Inspect", "Inspect relevant context"),
      step("Plan", "Prepare execution"),
      step("Execute", "Perform the task"),
      step("Verify", "Verify the result", "verification"),
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, when: "success" },
      { fromIndex: 1, toIndex: 2, when: "success" },
      { fromIndex: 2, toIndex: 3, when: "success" },
    ],
  },
  {
    id: "research-synthesize",
    version: "1.0.0",
    title: "Research and synthesize",
    nodes: [
      step("Research", "Collect relevant evidence", "subagent"),
      step("Synthesize", "Synthesize findings", "join"),
    ],
    edges: [{ fromIndex: 0, toIndex: 1, when: "always" }],
  },
  {
    id: "change-test-diff",
    version: "1.0.0",
    title: "Change, test, diff",
    nodes: [
      step("Change", "Apply the requested change"),
      step("Test", "Run relevant checks", "verification"),
      step("Diff", "Summarize changes", "join"),
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, when: "success" },
      { fromIndex: 1, toIndex: 2, when: "always" },
    ],
  },
  {
    id: "parallel-read-join",
    version: "1.0.0",
    title: "Parallel read and join",
    nodes: [
      step("Read A", "Inspect the first independent source", "subagent"),
      step("Read B", "Inspect the second independent source", "subagent"),
      step("Join", "Combine independent findings", "join"),
    ],
    edges: [
      { fromIndex: 0, toIndex: 2, when: "always" },
      { fromIndex: 1, toIndex: 2, when: "always" },
    ],
  },
  {
    id: "approval-action-verify",
    version: "1.0.0",
    title: "Approve, act, verify",
    nodes: [
      step("Approve", "Request approval", "approval"),
      step("Act", "Execute approved action"),
      step("Verify", "Verify the outcome", "verification"),
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, when: "success" },
      { fromIndex: 1, toIndex: 2, when: "success" },
    ],
  },
  {
    id: "failure-diagnose-retry-escalate",
    version: "1.0.0",
    title: "Diagnose and escalate failure",
    nodes: [
      step("Diagnose", "Diagnose the failure"),
      step("Retry", "Retry with the alternative strategy"),
      step("Escalate", "Request user decision", "approval"),
    ],
    edges: [
      { fromIndex: 0, toIndex: 1, when: "success" },
      { fromIndex: 1, toIndex: 2, when: "failure" },
    ],
  },
];

export function createBuiltinWorkflowRegistry(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  for (const workflow of BUILTIN_WORKFLOWS) registry.register(workflow);
  return registry;
}
