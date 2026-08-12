import { describe, expect, it } from "vitest";
import { buildRunCapsule, serializeCapsule } from "../run-capsule";
import type { MessageRecord } from "../../storage/db";

function makeMsg(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: `m-${Math.random()}`,
    conversationId: "c1",
    role: "user",
    content: "Hello",
    status: "complete",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("buildRunCapsule", () => {
  it("extracts objective from the first user message", () => {
    const msgs = [
      makeMsg({ role: "user", content: "Fix the bug in auth.ts" }),
      makeMsg({ role: "assistant", content: "Sure, looking into it." }),
    ];
    const capsule = buildRunCapsule(msgs);
    expect(capsule.objective).toBe("Fix the bug in auth.ts");
  });

  it("falls back to the checkpoint objective when there is no user message", () => {
    const capsule = buildRunCapsule([], {
      id: "cp-1",
      conversationId: "c1",
      createdAt: Date.now(),
      messageCount: 0,
      tokenEstimate: 0,
      summary: "",
      objective: "Refactor the API layer",
      completedSteps: [],
      pendingSteps: [],
      unresolvedErrors: [],
      userConstraints: [],
      approvals: [],
      changedArtifacts: [],
      verificationEvidence: [],
      relevantMemoryIds: [],
      contextSummaryVersion: "1",
      mode: "agent",
    });
    expect(capsule.objective).toBe("Refactor the API layer");
  });

  it("extracts user constraints containing must/must not/don't/不要/必须", () => {
    const msgs = [
      makeMsg({ role: "user", content: "Add a login page" }),
      makeMsg({ role: "user", content: "You must not delete the database" }),
      makeMsg({ role: "user", content: "don't touch the config file" }),
      makeMsg({ role: "user", content: "必须保留原有测试" }),
    ];
    const capsule = buildRunCapsule(msgs);
    expect(capsule.userConstraints).toEqual([
      "You must not delete the database",
      "don't touch the config file",
      "必须保留原有测试",
    ]);
  });

  it("extracts pending approvals from messages", () => {
    const pendingMsg = makeMsg({
      role: "assistant",
      content: "Requesting approval",
    }) as MessageRecord & {
      pendingApproval: { toolCallId: string; toolName: string };
    };
    pendingMsg.pendingApproval = { toolCallId: "tc-1", toolName: "run_command" };
    const capsule = buildRunCapsule([pendingMsg]);
    expect(capsule.pendingApprovals).toHaveLength(1);
    expect(capsule.pendingApprovals[0]).toContain("run_command");
    expect(capsule.activeRunState).toBe("blocked");
  });

  it("extracts file changes from write_file/apply_patch tool calls", () => {
    const msgs = [
      makeMsg({
        role: "assistant",
        toolCalls: [
          { id: "1", toolName: "write_file", arguments: { path: "/repo/src/a.ts" } },
          { id: "2", toolName: "apply_patch", arguments: { path: "/repo/src/b.ts" } },
          { id: "3", toolName: "read_file", arguments: { path: "/repo/src/c.ts" } },
        ],
      }),
    ];
    const capsule = buildRunCapsule(msgs);
    expect(capsule.fileChanges).toEqual(["/repo/src/a.ts", "/repo/src/b.ts"]);
  });

  it("extracts errors from failed tool results and error status messages", () => {
    const msgs = [
      makeMsg({ role: "assistant", status: "error", errorMessage: "API request failed" }),
      makeMsg({
        role: "assistant",
        toolResults: [
          { toolCallId: "1", toolName: "run_command", success: false, output: "command not found" },
        ],
      }),
    ];
    const capsule = buildRunCapsule(msgs);
    expect(capsule.errors).toContain("API request failed");
    expect(capsule.errors.some((e) => e.includes("command not found"))).toBe(true);
    expect(capsule.activeRunState).toBe("blocked");
  });

  it("extracts verification evidence from run_command/git_status/git_diff results", () => {
    const msgs = [
      makeMsg({
        role: "assistant",
        toolResults: [
          { toolCallId: "1", toolName: "run_command", success: true, output: "pnpm test passed" },
          { toolCallId: "2", toolName: "git_status", success: true, output: "clean" },
          { toolCallId: "3", toolName: "write_file", success: true, output: "wrote file" },
        ],
      }),
    ];
    const capsule = buildRunCapsule(msgs);
    expect(capsule.lastVerificationEvidence).toHaveLength(2);
    expect(capsule.lastVerificationEvidence.some((e) => e.includes("pnpm test passed"))).toBe(true);
    expect(capsule.lastVerificationEvidence.some((e) => e.includes("clean"))).toBe(true);
  });
});

describe("serializeCapsule", () => {
  it("produces a compact string with populated sections and omits empty ones", () => {
    const capsule = buildRunCapsule([
      makeMsg({ role: "user", content: "Ship the release" }),
      makeMsg({ role: "user", content: "must not skip tests" }),
    ]);
    const serialized = serializeCapsule(capsule);
    expect(serialized).toContain("Objective: Ship the release");
    expect(serialized).toContain("must not skip tests");
    expect(serialized).not.toContain("Pending approvals:");
    expect(serialized).not.toContain("Errors:");
  });
});
