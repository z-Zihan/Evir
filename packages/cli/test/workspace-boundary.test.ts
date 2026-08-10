import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveExistingWorkspacePath,
  resolveWorkspace,
  resolveWritableWorkspacePath,
} from "../src/workspace-boundary";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("CLI workspace boundary", () => {
  it("rejects traversal and symbolic-link escapes", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "evir-cli-workspace-"));
    temporary.push(parent);
    const root = path.join(parent, "project");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "escape"));
    const resolvedRoot = await resolveWorkspace(root);
    await expect(
      resolveExistingWorkspacePath(resolvedRoot, "../outside/secret.txt"),
    ).rejects.toThrow("escapes");
    await expect(resolveExistingWorkspacePath(resolvedRoot, "escape/secret.txt")).rejects.toThrow(
      "symbolic link",
    );
    await expect(resolveWritableWorkspacePath(resolvedRoot, "escape/new.txt")).rejects.toThrow(
      "symbolic link",
    );
  });
});
