import { describe, expect, it } from "vitest";
import {
  applyVerificationVerdict,
  verificationVerdict,
} from "../verification-verdict";

function result(status: "completed" | "failed", summary: string) {
  return { status, summary } as const;
}

describe("verificationVerdict", () => {
  it("reads the structured VERIFICATION_STATUS marker in any case/bold", () => {
    expect(verificationVerdict("All good.\nVERIFICATION_STATUS: PASSED")).toBe("passed");
    expect(verificationVerdict("VERIFICATION_STATUS: **FAILED**\nNothing written.")).toBe(
      "failed",
    );
    expect(verificationVerdict("verification_status: Partial")).toBe("partial");
  });

  it("keeps the legacy natural-language regex only as fallback", () => {
    expect(verificationVerdict("Verification Result: **FAILED** — not completed")).toBe(
      "failed",
    );
  });

  it("returns null for prose without a marker or legacy phrase", () => {
    expect(verificationVerdict("Verification failed. Acceptance criteria were not met.")).toBeNull();
    expect(verificationVerdict("验证失败。")).toBeNull();
    expect(verificationVerdict("未满足验收条件。")).toBeNull();
    expect(verificationVerdict("部分完成。")).toBeNull();
    expect(verificationVerdict("Everything looks great, task complete.")).toBeNull();
  });
});

describe("applyVerificationVerdict", () => {
  const verifyNode = { kind: "verification" };
  const taskNode = { kind: "task" };

  it("fails a completed verification whose structured verdict is FAILED", () => {
    const judged = applyVerificationVerdict(
      verifyNode,
      result("completed", "Checks ran.\nVERIFICATION_STATUS: FAILED"),
    );
    expect(judged.status).toBe("failed");
  });

  it("fails a completed verification with PARTIAL verdict (not a pass)", () => {
    const judged = applyVerificationVerdict(
      verifyNode,
      result("completed", "VERIFICATION_STATUS: PARTIAL — 2 of 3 criteria met"),
    );
    expect(judged.status).toBe("failed");
  });

  it("keeps a completed verification with PASSED verdict", () => {
    const judged = applyVerificationVerdict(
      verifyNode,
      result("completed", "Evidence collected.\nVERIFICATION_STATUS: PASSED"),
    );
    expect(judged.status).toBe("completed");
  });

  it("keeps the legacy regex fallback for older plans", () => {
    const judged = applyVerificationVerdict(
      verifyNode,
      result("completed", "Verification Result: FAILED — task was not completed"),
    );
    expect(judged.status).toBe("failed");
  });

  it("does not let unstructured prose decide the verdict", () => {
    const prose = "Verification failed. Acceptance criteria were not met.";
    const judged = applyVerificationVerdict(verifyNode, result("completed", prose));
    expect(judged.status).toBe("completed");
  });

  it("ignores non-verification nodes and non-completed results", () => {
    expect(
      applyVerificationVerdict(taskNode, result("completed", "VERIFICATION_STATUS: FAILED"))
        .status,
    ).toBe("completed");
    expect(
      applyVerificationVerdict(verifyNode, result("failed", "VERIFICATION_STATUS: PASSED"))
        .status,
    ).toBe("failed");
  });
});
