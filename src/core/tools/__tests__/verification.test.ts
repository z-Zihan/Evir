import { describe, expect, it, vi } from "vitest";
import type { EvirRuntime } from "../../../runtime/types";
import { TOOL_PERMISSION_REQUIRED } from "../tool-executor";
import { runVerification } from "../verification";

type ExecuteFn = NonNullable<EvirRuntime["toolExecutor"]>["execute"];

function desktopRuntime(entries: Array<{ name: string }>, execute: ExecuteFn): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(["filesystem", "terminal"]),
    has: () => true,
    mode: "agent",
    permissionContext: { profile: "workspace", roots: ["/project"] },
    storage: { listDir: vi.fn(() => Promise.resolve(entries)) },
    toolExecutor: { execute },
  } as unknown as EvirRuntime;
}

describe("runVerification", () => {
  it("executes the detected checker through the tool executor", async () => {
    const execute = vi.fn<ExecuteFn>();
    execute.mockResolvedValue({ success: true, output: "all good" });
    const result = await runVerification(
      "/project",
      desktopRuntime([{ name: "package.json" }], execute),
    );
    expect(result).toMatchObject({ command: "pnpm check", status: "passed", exitCode: 0 });
    expect(execute).toHaveBeenCalledWith(
      "run_command",
      expect.objectContaining({ cwd: "/project", program: "pnpm", args: ["check"] }),
      expect.objectContaining({ mode: "agent" }),
    );
  });

  it("skips instead of executing when the permission profile requires approval", async () => {
    const execute = vi.fn<ExecuteFn>();
    execute.mockResolvedValue({
      success: false,
      output: "Permission required",
      error: TOOL_PERMISSION_REQUIRED,
    });
    const result = await runVerification(
      "/project",
      desktopRuntime([{ name: "package.json" }], execute),
    );
    expect(result.status).toBe("skipped");
    expect(result.stderrPreview).toContain("permission profile");
  });

  it("fails the verification when the checker fails", async () => {
    const execute = vi.fn<ExecuteFn>();
    execute.mockResolvedValue({ success: false, output: "1 failing test" });
    const result = await runVerification(
      "/project",
      desktopRuntime([{ name: "package.json" }], execute),
    );
    expect(result).toMatchObject({ status: "failed", exitCode: 1 });
    expect(result.stderrPreview).toContain("1 failing test");
  });

  it("stays skipped without a recognized project config", async () => {
    const execute = vi.fn();
    const result = await runVerification(
      "/project",
      desktopRuntime([{ name: "notes.txt" }], execute),
    );
    expect(result.status).toBe("skipped");
    expect(execute).not.toHaveBeenCalled();
  });
});
