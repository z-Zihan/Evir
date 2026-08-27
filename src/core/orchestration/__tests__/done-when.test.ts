import { describe, expect, it, vi } from "vitest";

import {
  doneWhenSatisfied,
  evaluateDoneWhen,
  parseDoneWhenCriterion,
  splitCommand,
} from "../done-when";
import type { DoneWhenResult } from "../types";
import type { EvirRuntime } from "../../../runtime/types";

function desktopRuntime(
  runCommand: (
    cwd: string,
    program: string,
    args: string[],
  ) => Promise<{ success: boolean; exit_code: number | null; stdout: string; stderr: string }>,
): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(["filesystem", "terminal"]),
    has: () => true,
    storage: {
      runCommand: vi.fn(runCommand),
    },
  } as unknown as EvirRuntime;
}

describe("parseDoneWhenCriterion", () => {
  it("recognizes executable commands with pass markers", () => {
    expect(parseDoneWhenCriterion("pnpm check PASS")).toMatchObject({
      kind: "command",
      command: "pnpm check",
    });
    expect(parseDoneWhenCriterion("pnpm test:e2e 通过")).toMatchObject({
      kind: "command",
      command: "pnpm test:e2e",
    });
    expect(parseDoneWhenCriterion('node -e "process.exit(0)"')).toMatchObject({
      kind: "command",
    });
  });

  it("keeps review standards manual", () => {
    expect(parseDoneWhenCriterion("Code Review 无 P0/P1")).toEqual({
      kind: "manual",
      label: "Code Review 无 P0/P1",
    });
    expect(parseDoneWhenCriterion("不降低测试断言")).toEqual({
      kind: "manual",
      label: "不降低测试断言",
    });
  });
});

describe("evaluateDoneWhen", () => {
  it("passes and fails command criteria by real exit codes, not model claims", async () => {
    const runtime = desktopRuntime((_cwd, program) =>
      Promise.resolve(
        program === "pnpm" && true
          ? { success: true, exit_code: 0, stdout: "ok", stderr: "" }
          : { success: false, exit_code: 1, stdout: "", stderr: "boom" },
      ),
    );

    const results = await evaluateDoneWhen(
      ["pnpm check PASS", "cargo test PASS", "Code Review 无 P0"],
      runtime,
      "/project",
    );

    expect(results[0]).toMatchObject({ kind: "command", status: "passed" });
    // program "cargo" not "pnpm" -> failure path
    expect(results[1]).toMatchObject({ kind: "command", status: "failed" });
    expect(results[2]).toMatchObject({ kind: "manual", status: "manual" });
    expect(doneWhenSatisfied(results)).toBe(false);
  });

  it("manual-only criteria never block completion", async () => {
    const results = await evaluateDoneWhen(
      ["Code Review 无 P0/P1"],
      desktopRuntime(() =>
        Promise.resolve({ success: true, exit_code: 0, stdout: "", stderr: "" }),
      ),
      "/project",
    );
    expect(doneWhenSatisfied(results)).toBe(true);
  });

  it("skips negated expectations and missing workspaces", async () => {
    const runtime = desktopRuntime(() =>
      Promise.resolve({ success: true, exit_code: 0, stdout: "", stderr: "" }),
    );
    const results: DoneWhenResult[] = await evaluateDoneWhen(
      ["pnpm test 失败", "pnpm check PASS"],
      runtime,
      null,
    );
    expect(results[0]).toMatchObject({ status: "skipped" });
    expect(results[1]?.status).toBe("skipped");
    expect(results[1]?.evidence).toContain("No workspace");
    // Skipped is not passed: unrunnable criteria never silently satisfy.
    expect(
      doneWhenSatisfied(results.filter((result: DoneWhenResult) => result.kind === "command")),
    ).toBe(false);
  });

  it("turns command crashes into failed evidence", async () => {
    const runtime = desktopRuntime(() => Promise.reject(new Error("spawn failed")));
    const results = await evaluateDoneWhen(["make check"], runtime, "/project");
    expect(results[0]).toMatchObject({ status: "failed", evidence: "spawn failed" });
  });
});

describe("doneWhenSatisfied", () => {
  it("requires every executable criterion to pass", () => {
    const base: DoneWhenResult[] = [
      { label: "a", kind: "command", status: "passed", evidence: "" },
      { label: "b", kind: "manual", status: "manual", evidence: "" },
    ];
    expect(doneWhenSatisfied(base)).toBe(true);
    expect(
      doneWhenSatisfied([...base, { label: "c", kind: "command", status: "failed", evidence: "" }]),
    ).toBe(false);
    expect(doneWhenSatisfied([])).toBe(true);
  });
});

describe("splitCommand", () => {
  it("honors quoted arguments", () => {
    expect(splitCommand('node -e "process.exit(0)"')).toEqual(["node", "-e", "process.exit(0)"]);
  });
});
