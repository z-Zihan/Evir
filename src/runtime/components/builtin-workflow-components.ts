import type { ComponentDefinition } from "../../core/components/types";
import { BUILTIN_WORKFLOWS } from "../../core/orchestration/workflow-registry";

export const builtinWorkflowComponent: ComponentDefinition<null> = {
  manifest: {
    id: "evir.workflows.builtin",
    version: "1.0.0",
    kind: "workflow",
    targets: ["desktop"],
    provides: ["workflows:builtin"],
    requires: ["service:workflow-registry"],
    defaultEnabled: true,
    trust: "builtin",
  },
  parseConfig(input) {
    if (input !== undefined && input !== null)
      throw new Error("Builtin workflows do not accept configuration");
    return null;
  },
  activate(context) {
    for (const workflow of BUILTIN_WORKFLOWS) context.registerWorkflow(workflow);
  },
};
