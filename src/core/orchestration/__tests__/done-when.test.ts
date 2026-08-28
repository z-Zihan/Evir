import { describe, expect, it, vi } from "vitest";

import {
  doneWhenSatisfied,
  evaluateDoneWhen,
  parseDoneWhenCriterion,
  splitCommand,
} from "../done-when";
import { TOOL_PERMISSION_REQUIRED } from "../../tools/tool-executor";
import type { DoneWhenResult } from "../types";
import type { EvirRuntime } from "../../../runtime/types";
import type { ToolResult } from "../../providers/tool-registry";

type ExecuteFn = NonNullable<EvirRuntime["toolExecutor"]>["execute"];

function desktopRuntime(execute: ExecuteFn): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(["filesystem", "terminal"]),
    has: () => true,
    mode: "goal",
    permissionContext: { profile: "full", roots: ["/project"] },
    storage: {},
    toolExecutor: { execute },
  } as unknown as EvirRuntime;
}

function ok(output = "ok"): ToolResult {
  return { success: true, output };
}
function fail(output: string): ToolResult {
  return { success: false, output };
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
    expect(parseDoneWhenCriterion("./scripts/check.sh 通过")).toMatchObject({
      kind: "command",
      command: "./scripts/check.sh",
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

  it("never promotes Chinese prose around a command into a program", () => {
    // Prose prefix must not become the program (previously spawned "运行").
    expect(parseDoneWhenCriterion("运行 cargo test 且全部通过").kind).toBe("manual");
    expect(parseDoneWhenCriterion("所有 e2e 测试通过").kind).toBe("manual");
    // CJK glued onto an argument means the criterion is not machine-parseable.
    expect(parseDoneWhenCriterion("cargo test全部通过").kind).toBe("manual");
    // Clean Chinese marker + ASCII command stays executable.
    expect(parseDoneWhenCriterion("cargo test 通过")).toMatchObject({
      kind: "command",
      command: "cargo test",
    });
  });
});

describe("evaluateDoneWhen", () => {
  it("passes and fails command criteria by real exit codes, not model claims", async () => {
    const execute = vi.fn<ExecuteFn>();
    execute.mockImplementation((_name, args) =>
      Promise.resolve((args as { program: string }).program === "pnpm" ? ok() : fail("boom")),
    );
    const runtime = desktopRuntime(execute);

    const results = await evaluateDoneWhen(
      ["pnpm check PASS", "cargo test PASS", "Code Review 无 P0"],
      runtime,
      "/project",
    );

    expect(results[0]).toMatchObject({ kind: "command", status: "passed" });
    expect(results[1]).toMatchObject({ kind: "command", status: "failed" });
    expect(results[2]).toMatchObject({ kind: "manual", status: "manual" });
    expect(execute).toHaveBeenCalledWith(
      "run_command",
      expect.objectContaining({ cwd: "/project", program: "pnpm", args: ["check"] }),
      expect.objectContaining({ mode: "goal" }),
    );
    expect(doneWhenSatisfied(results)).toBe(false);
  });

  it("manual-only criteria never block completion", async () => {
    const results = await evaluateDoneWhen(
      ["Code Review 无 P0/P1"],
      desktopRuntime(() => Promise.resolve(ok())),
      "/project",
    );
    expect(doneWhenSatisfied(results)).toBe(true);
  });

  it("skips negated expectations and missing workspaces", async () => {
    const runtime = desktopRuntime(() => Promise.resolve(ok()));
    const results: DoneWhenResult[] = await evaluateDoneWhen(
      ["pnpm test 失败", "pnpm check PASS"],
      runtime,
      null,
    );
    // Chinese negation is detected even with a valid workspace.
    expect(results[0]).toMatchObject({ status: "skipped" });
    expect(results[0]?.evidence).toContain("Negated");
    expect(results[1]?.status).toBe("skipped");
    expect(results[1]?.evidence).toContain("No workspace");
    // Skipped is not passed: unrunnable criteria never silently satisfy.
    expect(
      doneWhenSatisfied(results.filter((result: DoneWhenResult) => result.kind === "command")),
    ).toBe(false);
  });

  it("downgrades to manual when the permission profile does not allow execution", async () => {
    const execute = vi.fn<ExecuteFn>();
    execute.mockResolvedValue({
      success: false,
      output: "Permission required",
      error: TOOL_PERMISSION_REQUIRED,
    });
    const results = await evaluateDoneWhen(["pnpm check"], desktopRuntime(execute), "/project");
    expect(results[0]).toMatchObject({ kind: "command", status: "manual" });
    expect(results[0]?.evidence).toContain("permission profile");
    // An unexecuted command criterion must not silently satisfy the goal —
    // the user confirms it manually or re-runs with a permissive profile.
    expect(doneWhenSatisfied(results)).toBe(false);
  });

  it("turns command crashes into failed evidence", async () => {
    const execute = vi.fn<ExecuteFn>();
    execute.mockRejectedValue(new Error("spawn failed"));
    const results = await evaluateDoneWhen(["make check"], desktopRuntime(execute), "/project");
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
