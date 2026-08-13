import { describe, expect, it } from "vitest";
import { AgentDispatcher, restrictTools } from "../agent-dispatcher";

describe("AgentDispatcher", () => {
  it("restricts child tools to the parent set", () => {
    expect(restrictTools(["read_file", "git_status"], ["read_file", "run_command"])).toEqual([
      "read_file",
    ]);
  });

  it("validates worker reports and assignment identity", async () => {
    const dispatcher = new AgentDispatcher({
      execute: (assignment) =>
        Promise.resolve({
          assignmentId: assignment.id,
          status: "completed",
          summary: "done",
          artifacts: [],
          verificationEvidence: ["verified"],
          unresolvedErrors: [],
        }),
    });
    const assignment = dispatcher.createAssignment({
      parentRunId: "run-1",
      nodeId: "node-1",
      objective: "Inspect",
      allowedTools: ["read_file"],
      resourceScopes: [],
      contextReferences: [],
      expectedOutputSchema: {},
      budget: { maxTurns: 12 },
    });
    await expect(
      dispatcher.dispatch(assignment, new AbortController().signal),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("rejects unknown fields in worker reports", async () => {
    const dispatcher = new AgentDispatcher({
      execute: (assignment) =>
        Promise.resolve({
          assignmentId: assignment.id,
          status: "completed",
          summary: "done",
          artifacts: [],
          verificationEvidence: ["verified"],
          unresolvedErrors: [],
          hiddenReasoning: "must not cross the worker boundary",
        }),
    });
    const assignment = dispatcher.createAssignment({
      parentRunId: "run-1",
      nodeId: "node-1",
      objective: "Inspect",
      allowedTools: ["read_file"],
      resourceScopes: [],
      contextReferences: [],
      expectedOutputSchema: {},
      budget: { maxTurns: 12 },
    });

    await expect(dispatcher.dispatch(assignment, new AbortController().signal)).rejects.toThrow();
  });
});
