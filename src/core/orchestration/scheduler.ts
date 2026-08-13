import type { NodeStatus, PlanEdge, PlanGraph, PlanNode, ResourceScope } from "./types";

export interface NodeExecutionResult {
  status: "completed" | "failed" | "blocked" | "cancelled";
  summary: string;
}

export type NodeExecutor = (node: PlanNode, signal: AbortSignal) => Promise<NodeExecutionResult>;

export interface SchedulerHooks {
  onPlanChanged?(plan: PlanGraph): void | Promise<void>;
  onNodeReady?(node: PlanNode): void | Promise<void>;
  onNodeStarted?(node: PlanNode): void | Promise<void>;
  onNodeFinished?(node: PlanNode, result: NodeExecutionResult): void | Promise<void>;
  onNodeSkipped?(node: PlanNode): void | Promise<void>;
}

function scopesConflict(left: ResourceScope, right: ResourceScope): boolean {
  if (left.access === "read" && right.access === "read") return false;
  if (
    left.kind === "network" ||
    left.kind === "external" ||
    right.kind === "network" ||
    right.kind === "external"
  ) {
    return left.kind === right.kind && left.value === right.value;
  }
  if (left.kind === "git" || right.kind === "git") return left.kind === right.kind;
  if (left.kind === "workspace" || right.kind === "workspace") return left.value === right.value;
  const leftPath = left.value.replace(/\/$/, "");
  const rightPath = right.value.replace(/\/$/, "");
  return (
    leftPath === rightPath ||
    leftPath.startsWith(`${rightPath}/`) ||
    rightPath.startsWith(`${leftPath}/`)
  );
}

export function resourcesConflict(left: PlanNode, right: PlanNode): boolean {
  if (left.resourceScopes.length === 0 || right.resourceScopes.length === 0) return true;
  return left.resourceScopes.some((a) => right.resourceScopes.some((b) => scopesConflict(a, b)));
}

function dependencySatisfied(edge: PlanEdge, source: PlanNode): boolean {
  if (edge.when === "always")
    return ["completed", "failed", "skipped", "cancelled"].includes(source.status);
  if (edge.when === "failure") return source.status === "failed";
  return source.status === "completed";
}

function isReady(node: PlanNode, plan: PlanGraph): boolean {
  if (node.status !== "pending" && node.status !== "ready") return false;
  if (node.dependencies.length === 0) return true;
  return node.dependencies.every((dependency) => {
    const source = plan.nodes.find(({ id }) => id === dependency);
    if (!source) return false;
    const edges = plan.edges.filter(({ from, to }) => from === dependency && to === node.id);
    return edges.length === 0
      ? source.status === "completed"
      : edges.some((edge) => dependencySatisfied(edge, source));
  });
}

function shouldSkip(node: PlanNode, plan: PlanGraph): boolean {
  if (node.status !== "pending" && node.status !== "ready") return false;
  if (node.dependencies.length === 0) return false;
  const terminal = new Set<NodeStatus>(["completed", "failed", "skipped", "cancelled"]);
  const sources = node.dependencies.map((id) =>
    plan.nodes.find((candidate) => candidate.id === id),
  );
  return sources.every((source) => source && terminal.has(source.status)) && !isReady(node, plan);
}

function finishStatus(plan: PlanGraph): PlanGraph["status"] {
  if (plan.nodes.some(({ status }) => status === "cancelled")) return "cancelled";
  const failed = plan.nodes.filter(({ status }) => status === "failed").length;
  const completed = plan.nodes.filter(({ status }) => status === "completed").length;
  const skipped = plan.nodes.filter(({ status }) => status === "skipped").length;
  if (failed === 0 && completed + skipped === plan.nodes.length) return "completed";
  if (failed > 0 && completed > 0) return "partial";
  return "failed";
}

export class GraphScheduler {
  private controller: AbortController | null = null;
  private paused = false;

  constructor(
    private readonly executor: NodeExecutor,
    private readonly maxParallelWorkers = 2,
    private readonly hooks: SchedulerHooks = {},
  ) {
    if (maxParallelWorkers < 1 || maxParallelWorkers > 4)
      throw new RangeError("maxParallelWorkers must be 1-4");
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  cancel(): void {
    this.controller?.abort();
  }

  async run(input: PlanGraph): Promise<PlanGraph> {
    this.controller = new AbortController();
    let plan: PlanGraph = { ...input, status: "running", updatedAt: Date.now() };
    while (!this.controller.signal.aborted) {
      if (this.paused) return { ...plan, status: "paused", updatedAt: Date.now() };
      const candidates = plan.nodes.filter((node) => isReady(node, plan));
      if (candidates.length === 0) {
        const skipped = plan.nodes.filter((node) => shouldSkip(node, plan));
        if (skipped.length === 0) break;
        const skippedIds = new Set(skipped.map(({ id }) => id));
        plan = {
          ...plan,
          nodes: plan.nodes.map((node) =>
            skippedIds.has(node.id) ? { ...node, status: "skipped" } : node,
          ),
          updatedAt: Date.now(),
        };
        for (const node of skipped) await this.hooks.onNodeSkipped?.(node);
        await this.hooks.onPlanChanged?.(plan);
        continue;
      }
      const batch: PlanNode[] = [];
      for (const candidate of candidates) {
        if (batch.length >= this.maxParallelWorkers) break;
        if (!batch.some((active) => resourcesConflict(active, candidate))) batch.push(candidate);
      }
      if (batch.length === 0) batch.push(candidates[0]!);
      const batchIds = new Set(batch.map(({ id }) => id));
      plan = {
        ...plan,
        nodes: plan.nodes.map((node) =>
          batchIds.has(node.id) ? { ...node, status: "running" } : node,
        ),
        updatedAt: Date.now(),
      };
      for (const node of batch) await this.hooks.onNodeReady?.(node);
      for (const node of batch) await this.hooks.onNodeStarted?.(node);
      await this.hooks.onPlanChanged?.(plan);
      const results = await Promise.all(
        batch.map(async (node) => {
          const result = await this.executor(node, this.controller!.signal);
          await this.hooks.onNodeFinished?.(node, result);
          return { id: node.id, result };
        }),
      );
      const byId = new Map(results.map(({ id, result }) => [id, result]));
      if (results.some(({ result }) => result.status === "cancelled")) this.controller.abort();
      plan = {
        ...plan,
        nodes: plan.nodes.map((node) => {
          const result = byId.get(node.id);
          return result ? { ...node, status: result.status } : node;
        }),
        updatedAt: Date.now(),
      };
      await this.hooks.onPlanChanged?.(plan);
      if (results.some(({ result }) => result.status === "blocked"))
        return { ...plan, status: "paused" };
    }
    if (this.controller.signal.aborted) {
      return {
        ...plan,
        status: "cancelled",
        nodes: plan.nodes.map((node) =>
          node.status === "running" ? { ...node, status: "cancelled" } : node,
        ),
        updatedAt: Date.now(),
      };
    }
    return { ...plan, status: finishStatus(plan), updatedAt: Date.now() };
  }
}
