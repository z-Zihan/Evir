import { describe, expect, it } from "vitest";

import type { ToolResultRecord } from "../../storage/db";
import { TaskResolver } from "../verification-evidence";

function makeResult(overrides: Partial<ToolResultRecord>): ToolResultRecord {
  return {
    toolCallId: "call-1",
    toolName: "run_command",
    success: true,
    output: "",
    ...overrides,
  };
}

describe("TaskResolver", () => {
  const resolver = new TaskResolver();

  it("collectEvidence extracts command_result from run_command results", () => {
    const results = [makeResult({ toolName: "run_command", output: "ok" })];
    const evidence = resolver.collectEvidence(results, 123);

    expect(evidence).toEqual([
      {
        type: "command_result",
        toolName: "run_command",
        success: true,
        summary: "ok",
        timestamp: 123,
      },
    ]);
  });

  it("collectEvidence extracts git_status evidence from git_status results", () => {
    const results = [makeResult({ toolName: "git_status", output: "nothing to commit" })];
    const evidence = resolver.collectEvidence(results, 456);

    expect(evidence).toEqual([
      {
        type: "git_status",
        toolName: "git_status",
        success: true,
        summary: "nothing to commit",
        timestamp: 456,
      },
    ]);
  });

  it("hasVerificationEvidence returns true when run_command present", () => {
    const evidence = resolver.collectEvidence([makeResult({ toolName: "run_command" })]);
    expect(resolver.hasVerificationEvidence(evidence)).toBe(true);
  });

  it("hasVerificationEvidence returns false when only read_file present", () => {
    const evidence = resolver.collectEvidence([makeResult({ toolName: "read_file" })]);
    expect(resolver.hasVerificationEvidence(evidence)).toBe(false);
  });

  it("resolveTask rejects modelClaimsComplete=true with no evidence", () => {
    const evidence = resolver.collectEvidence([makeResult({ toolName: "read_file" })]);
    const result = resolver.resolveTask(evidence, true);

    expect(result.complete).toBe(false);
    expect(result.reason).toMatch(/no verification evidence/i);
  });

  it("resolveTask accepts modelClaimsComplete=true with command evidence", () => {
    const evidence = resolver.collectEvidence([
      makeResult({ toolName: "run_command", success: true }),
    ]);
    const result = resolver.resolveTask(evidence, true);

    expect(result.complete).toBe(true);
    expect(result.reason).toMatch(/verification evidence supports it/i);
  });

  it("resolveTask accepts modelClaimsComplete=false regardless", () => {
    const withEvidence = resolver.collectEvidence([
      makeResult({ toolName: "run_command", success: true }),
    ]);
    const withoutEvidence = resolver.collectEvidence([makeResult({ toolName: "read_file" })]);

    expect(resolver.resolveTask(withEvidence, false)).toEqual({
      complete: false,
      reason: "Model has not claimed the task is complete.",
    });
    expect(resolver.resolveTask(withoutEvidence, false)).toEqual({
      complete: false,
      reason: "Model has not claimed the task is complete.",
    });
  });
});
