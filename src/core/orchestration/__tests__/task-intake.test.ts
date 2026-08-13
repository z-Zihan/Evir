import { describe, expect, it } from "vitest";
import { answerClarifications, blockingUnknowns, TaskIntakeService } from "../task-intake";

const input = {
  runId: "run-1",
  conversationId: "conversation-1",
  objective: "Implement the requested settings page and verify it with existing tests",
  workspacePath: "/workspace",
};

describe("TaskIntakeService", () => {
  it("does not interrupt a clear task", async () => {
    const brief = await new TaskIntakeService().createBrief(input);
    expect(brief.goalKind).toBe("change");
    expect(blockingUnknowns(brief)).toEqual([]);
    expect(brief.assumptions[0]?.statement).toContain("existing checks");
  });

  it("blocks local work without an authorized workspace", async () => {
    const brief = await new TaskIntakeService().createBrief({ ...input, workspacePath: null });
    expect(blockingUnknowns(brief).map(({ impact }) => impact)).toContain("permission");
  });

  it("records answers and limits clarification rounds", async () => {
    const brief = await new TaskIntakeService().createBrief({
      ...input,
      objective: "改一下",
      workspacePath: null,
    });
    const answers = Object.fromEntries(
      brief.unknowns.map(({ id }) => [id, "Use /workspace and existing checks"]),
    );
    const answered = answerClarifications(brief, answers);
    expect(blockingUnknowns(answered)).toEqual([]);
    expect(answered.clarificationRound).toBe(1);
    expect(
      answered.assumptions.every(
        ({ source }) => source === "inferred" || source === "user-confirmed",
      ),
    ).toBe(true);
  });

  it("uses structured model analysis and normalizes untrusted ids", async () => {
    const brief = await new TaskIntakeService({
      analyze: () =>
        Promise.resolve({
          goalKind: "inspect",
          objective: "Inspect architecture",
          constraints: ["read only"],
          deliverables: ["report"],
          acceptanceCriteria: ["cite files"],
          requiredCapabilities: ["chat", "filesystem"],
          assumptions: ["workspace is current"],
          unknowns: [],
          risk: "low",
        }),
    }).createBrief(input);
    expect(brief.runId).toBe("run-1");
    expect(brief.goalKind).toBe("inspect");
    expect(brief.constraints).toEqual(["read only"]);
  });

  it("does not treat an English marker embedded in another word as intent", async () => {
    const brief = await new TaskIntakeService().createBrief({
      ...input,
      objective: "Explain this fixture",
      workspacePath: null,
    });
    expect(brief.goalKind).toBe("answer");
    expect(blockingUnknowns(brief)).toEqual([]);
  });

  it("rejects unknown fields from model task analysis", async () => {
    const brief = await new TaskIntakeService({
      analyze: () =>
        Promise.resolve({
          goalKind: "inspect",
          objective: "Inspect architecture",
          constraints: ["read only"],
          deliverables: ["report"],
          acceptanceCriteria: ["cite files"],
          requiredCapabilities: ["chat", "filesystem"],
          assumptions: [],
          unknowns: [],
          risk: "low",
          hiddenReasoning: "must not cross the intake boundary",
        }),
    }).createBrief(input);

    expect(brief.goalKind).toBe("change");
    expect(brief.constraints).toEqual([]);
  });
});
