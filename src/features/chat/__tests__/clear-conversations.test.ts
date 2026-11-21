import { describe, expect, it } from "vitest";
import { buildClearConversationsMutations } from "../clear-conversations";

describe("buildClearConversationsMutations", () => {
  it("purges every conversation-scoped row while keeping non-conversation data", () => {
    const row = (id: string) => ({ id });
    const mutations = buildClearConversationsMutations({
      memories: [
        { id: "mem-conv", type: "conversation" },
        { id: "mem-workspace", type: "workspace" },
        { id: "mem-long-term", type: "long-term" },
      ],
      settings: [
        { name: "checkpoint:conv-1", value: {} },
        { name: "checkpoint:conv-2", value: {} },
        { name: "memory.enabled", value: true },
      ],
      toolExecutions: [row("exec-1"), row("exec-2")],
      agentRuns: [row("run-1")],
      taskBriefs: [row("brief-1")],
      plans: [row("plan-1")],
      runSteps: [row("step-1")],
      runEvents: [row("event-1")],
      agentAssignments: [row("assignment-1")],
      approvals: [row("approval-1"), row("approval-2")],
      artifacts: [
        { id: "summary-archive", relatedEntityId: "conv-1" },
        { id: "stored-artifact", relatedEntityId: null },
      ],
    });
    const deleted = (entity: string) =>
      mutations.flatMap((mutation) =>
        mutation.type === "delete" && mutation.entity === entity ? [mutation.id] : [],
      );
    const cleared = mutations.flatMap((mutation) =>
      mutation.type === "clear" ? [mutation.entity] : [],
    );

    expect(cleared).toEqual(["conversations", "messages", "attachments"]);
    expect(deleted("tool_executions")).toEqual(["exec-1", "exec-2"]);
    expect(deleted("agent_runs")).toEqual(["run-1"]);
    expect(deleted("task_briefs")).toEqual(["brief-1"]);
    expect(deleted("plans")).toEqual(["plan-1"]);
    expect(deleted("run_steps")).toEqual(["step-1"]);
    expect(deleted("run_events")).toEqual(["event-1"]);
    expect(deleted("agent_assignments")).toEqual(["assignment-1"]);
    expect(deleted("approvals")).toEqual(["approval-1", "approval-2"]);
    expect(deleted("artifacts")).toEqual(["summary-archive"]);
    expect(deleted("memories")).toEqual(["mem-conv"]);
    expect(deleted("settings")).toEqual(["checkpoint:conv-1", "checkpoint:conv-2"]);
  });
});
