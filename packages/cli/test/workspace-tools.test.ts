import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceTools } from "../src/workspace-tools";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function makeTrapScript(): Promise<{ script: string; pidFile: string; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "evir-cli-trap-"));
  temporary.push(root);
  const script = path.join(root, "trap.cjs");
  const pidFile = path.join(root, "pid.txt");
  await writeFile(
    script,
    [
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.argv[2], String(process.pid));",
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1000);",
      "console.log('alive');",
    ].join("\n"),
  );
  return { script, pidFile, root };
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`process ${pid} did not exit within ${timeoutMs}ms`);
}

describe("CLI run_command process termination", () => {
  it.skipIf(process.platform === "win32")(
    "escalates to SIGKILL after the SIGTERM grace window",
    async () => {
      const { script, pidFile, root } = await makeTrapScript();
      const tools = createWorkspaceTools(root);
      const run = tools.find((candidate) => candidate.name === "run_command")!;
      await expect(
        run.execute(
          { program: process.execPath, args: [script, pidFile], timeoutMs: 1000 },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      await waitForExit(pid, 8000);
    },
    10_000,
  );

  it.skipIf(process.platform === "win32")(
    "aborted commands also get the SIGKILL escalation",
    async () => {
      const { script, pidFile, root } = await makeTrapScript();
      const tools = createWorkspaceTools(root);
      const run = tools.find((candidate) => candidate.name === "run_command")!;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      await expect(
        run.execute(
          { program: process.execPath, args: [script, pidFile], timeoutMs: 120_000 },
          controller.signal,
        ),
      ).rejects.toThrow("Command stopped");
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      await waitForExit(pid, 8000);
    },
    10_000,
  );

  it("fast command resolves with output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "evir-cli-fast-"));
    temporary.push(root);
    const tools = createWorkspaceTools(root);
    const run = tools.find((candidate) => candidate.name === "run_command")!;
    const output = await run.execute(
      { program: process.execPath, args: ["-e", "console.log(42)"], timeoutMs: 1000 },
      new AbortController().signal,
    );
    expect(output).toContain("42");
  });
});
