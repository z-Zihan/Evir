import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceTools } from "../src/workspace-tools";
import { resolveWorkspace } from "../src/workspace-boundary";
import type { SpillResult } from "../src/artifacts";

const SPILL_THRESHOLD_BYTES = 256 * 1024;

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
    // Within the 256KB threshold, behavior is unchanged from before streaming
    // spill support: a plain string, no `artifact` field.
    expect(typeof output).toBe("string");
    expect(output).toContain("42");
  });
});

async function makeGitWorkspace(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "evir-cli-run-command-spill-"));
  temporary.push(created);
  const root = await resolveWorkspace(created);
  spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}

describe("CLI run_command artifact spill (real subprocess)", () => {
  it("spills a >256KB stdout output to an artifact file with byte-identical content", async () => {
    const root = await makeGitWorkspace();
    const tools = createWorkspaceTools(root);
    const run = tools.find((candidate) => candidate.name === "run_command")!;
    const totalBytes = 300 * 1024;
    const result = await run.execute(
      {
        program: process.execPath,
        args: ["-e", `process.stdout.write("a".repeat(${totalBytes}))`],
        timeoutMs: 30_000,
      },
      new AbortController().signal,
    );

    expect(typeof result).toBe("object");
    const spill = result as SpillResult;
    const artifact = spill.artifact;
    if (!artifact) throw new Error("expected an artifact");
    expect(artifact.bytes).toBe(totalBytes);
    expect(spill.content.length).toBeLessThan(SPILL_THRESHOLD_BYTES);
    expect(spill.content).toContain(artifact.path);
    expect(spill.content.toLowerCase()).toContain("truncated");

    const onDisk = await stat(path.join(root, artifact.path));
    expect(onDisk.size).toBe(totalBytes);
    const written = await readFile(path.join(root, artifact.path));
    expect(Buffer.compare(written, Buffer.from("a".repeat(totalBytes)))).toBe(0);
  }, 30_000);
});
