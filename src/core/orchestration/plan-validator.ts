import type { Capability } from "../../runtime/types";
import { planGraphSchema } from "./schemas";
import type { PlanGraph, PlanNode, WorkflowDefinition } from "./types";

export interface PlanValidationContext {
  capabilities: ReadonlySet<Capability>;
  workflowIds: ReadonlySet<string>;
  workflows?: readonly WorkflowDefinition[];
  requireVerification?: boolean;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

function hasCycle(nodes: PlanNode[]): boolean {
  const dependencies = new Map(nodes.map((node) => [node.id, node.dependencies]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some(({ id }) => visit(id));
}

function workflowDepth(
  workflowId: string,
  workflows: ReadonlyMap<string, WorkflowDefinition>,
  visiting = new Set<string>(),
): number {
  if (visiting.has(workflowId)) return Number.POSITIVE_INFINITY;
  const workflow = workflows.get(workflowId);
  if (!workflow) return 1;
  const next = new Set(visiting).add(workflowId);
  const nested = workflow.nodes.flatMap(({ kind, subgraphId }) =>
    kind === "subgraph" && subgraphId ? [workflowDepth(subgraphId, workflows, next)] : [],
  );
  return 1 + (nested.length > 0 ? Math.max(...nested) : 0);
}

export function validatePlanGraph(
  input: PlanGraph,
  context: PlanValidationContext,
): PlanValidationResult {
  const parsed = planGraphSchema.safeParse(input);
  if (!parsed.success)
    return { valid: false, errors: parsed.error.issues.map(({ message }) => message) };
  const plan = parsed.data;
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const workflows = new Map(context.workflows?.map((workflow) => [workflow.id, workflow]) ?? []);
  for (const node of plan.nodes) {
    if (nodeIds.has(node.id)) errors.push(`duplicate-node:${node.id}`);
    nodeIds.add(node.id);
  }
  for (const node of plan.nodes) {
    for (const dependency of node.dependencies) {
      if (!nodeIds.has(dependency)) errors.push(`missing-dependency:${node.id}:${dependency}`);
    }
    for (const capability of node.requiredCapabilities) {
      if (!context.capabilities.has(capability))
        errors.push(`missing-capability:${node.id}:${capability}`);
    }
    if (
      node.kind === "subgraph" &&
      (!node.subgraphId || !context.workflowIds.has(node.subgraphId))
    ) {
      errors.push(`unknown-subgraph:${node.id}:${node.subgraphId ?? "missing"}`);
    }
    if (
      node.kind === "subgraph" &&
      node.subgraphId &&
      workflows.has(node.subgraphId) &&
      workflowDepth(node.subgraphId, workflows) > 3
    ) {
      errors.push(`subgraph-depth-exceeded:${node.id}`);
    }
    const hazardous = node.resourceScopes.some(
      ({ kind, access }) => access === "write" || kind === "network" || kind === "external",
    );
    if (hazardous && node.kind !== "approval") {
      const hasApprovalDependency = node.dependencies.some(
        (id) => plan.nodes.find((candidate) => candidate.id === id)?.kind === "approval",
      );
      if (!hasApprovalDependency) errors.push(`missing-approval-boundary:${node.id}`);
    }
  }
  const dependencyEdges = new Map<string, Set<string>>();
  for (const edge of plan.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      errors.push(`invalid-edge:${edge.from}:${edge.to}`);
    const sources = dependencyEdges.get(edge.to) ?? new Set<string>();
    if (sources.has(edge.from)) errors.push(`duplicate-edge:${edge.from}:${edge.to}`);
    sources.add(edge.from);
    dependencyEdges.set(edge.to, sources);
  }
  for (const node of plan.nodes) {
    const dependencies = new Set(node.dependencies);
    const edgeSources = dependencyEdges.get(node.id) ?? new Set<string>();
    if (
      dependencies.size !== node.dependencies.length ||
      dependencies.size !== edgeSources.size ||
      [...dependencies].some((dependency) => !edgeSources.has(dependency))
    ) {
      errors.push(`dependency-edge-mismatch:${node.id}`);
    }
  }
  if (context.requireVerification && !plan.nodes.some(({ kind }) => kind === "verification"))
    errors.push("missing-verification-node");
  if (hasCycle(plan.nodes)) errors.push("cyclic-plan");
  return { valid: errors.length === 0, errors };
}

export function validatePlanRevision(previous: PlanGraph, next: PlanGraph): PlanValidationResult {
  const errors: string[] = [];
  if (next.revision !== previous.revision + 1) errors.push("invalid-revision");
  for (const running of previous.nodes.filter(({ status }) => status === "running")) {
    if (!next.nodes.some(({ id }) => id === running.id))
      errors.push(`removed-running-node:${running.id}`);
  }
  return { valid: errors.length === 0, errors };
}
