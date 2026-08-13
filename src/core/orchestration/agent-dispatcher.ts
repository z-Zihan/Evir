import { workerReportSchema } from "./schemas";
import type { AgentAssignment, WorkerReport } from "./types";

export interface WorkerExecutorPort {
  execute(assignment: AgentAssignment, signal: AbortSignal): Promise<unknown>;
}

export class AgentDispatcher {
  constructor(private readonly executor: WorkerExecutorPort) {}

  createAssignment(
    input: Omit<AgentAssignment, "id" | "depth" | "status" | "createdAt" | "updatedAt">,
  ): AgentAssignment {
    const now = Date.now();
    return {
      ...input,
      id: crypto.randomUUID(),
      depth: 1,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
  }

  async dispatch(assignment: AgentAssignment, signal: AbortSignal): Promise<WorkerReport> {
    if (assignment.depth !== 1) throw new Error("Nested sub-agents are not allowed");
    const report = workerReportSchema.parse(await this.executor.execute(assignment, signal));
    if (report.assignmentId !== assignment.id) throw new Error("Worker report assignment mismatch");
    return report;
  }
}

export function restrictTools(
  parentTools: readonly string[],
  requestedTools: readonly string[],
): string[] {
  const parent = new Set(parentTools);
  return [...new Set(requestedTools)].filter((tool) => parent.has(tool));
}
