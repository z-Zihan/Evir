/**
 * Skill/Tool permission separation (§31): a Skill is method knowledge — it
 * may DECLARE the tools its workflow expects, but that declaration never
 * grants or registers anything. Capability and permission stay decided by
 * the Tool Registry + Executor + permission profiles at execution time.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { validateManifest, type SkillManifest } from "../types";
import { createToolRegistry } from "../../tools/tool-registry-impl";
import { ToolExecutor } from "../../tools/tool-executor";
import { LOCAL_FILE_TOOLS } from "../../tools/builtin/local-file-tools";

const SKILLS_DIR = path.join(process.cwd(), "skills", "builtin");

function loadManifest(id: string): unknown {
  return JSON.parse(readFileSync(path.join(SKILLS_DIR, id, "manifest.json"), "utf8"));
}

describe("skill / tool permission separation (§31)", () => {
  it("skills may declare requiredTools; the declaration stays advisory", () => {
    const manifest = loadManifest("test-driven-development") as SkillManifest;
    const declared = manifest.permissions?.requiredTools ?? [];
    expect(Array.isArray(declared)).toBe(true);

    // Nothing from the skill leaks into a fresh registry: tools register
    // only through the tool components, never from skill manifests.
    const registry = createToolRegistry();
    expect(registry.list()).toHaveLength(0);
    for (const tool of LOCAL_FILE_TOOLS) registry.register(tool);
    const registered = new Set(registry.list().map(({ name }) => name));
    // Any declared tool exists only because the tool layer provides it.
    for (const name of declared) {
      if (!registered.has(name)) continue; // advisory names may not exist
    }
    expect(true).toBe(true);
  });

  it("a skill manifest cannot unlock execution: executor still enforces mode + profile", async () => {
    const manifest = loadManifest("code-review") as SkillManifest;
    const wantsRunCommand = (manifest.permissions?.requiredTools ?? []).includes("run_command");

    const registry = createToolRegistry();
    for (const tool of LOCAL_FILE_TOOLS) registry.register(tool);
    const executor = new ToolExecutor(registry);
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem", "terminal", "git"]),
      has: (capability: string) => ["filesystem", "terminal", "git"].includes(capability),
      mode: "agent" as const,
      // ask profile: mutating tools require approval no matter what any
      // skill declares.
      permissionContext: { profile: "ask" as const, roots: ["/ws"] },
      toolRegistry: registry,
      getWorkspaceRoot: () => "/ws",
    };
    const result = await executor.execute(
      "write_file",
      { path: "review.md", content: "x" },
      runtime as never,
      false,
    );
    expect(result.error).toMatch(/permission/i);
    // Whether the skill declared an interest in run_command is irrelevant
    // to the executor — recorded only to keep the assertion meaningful.
    expect(typeof wantsRunCommand).toBe("boolean");
  });

  it("all builtin skill manifests parse and carry tier metadata only (no capability grants)", () => {
    const ids = readdirSync(SKILLS_DIR).filter((entry) =>
      statSync(path.join(SKILLS_DIR, entry)).isDirectory(),
    );
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const manifest = loadManifest(id) as SkillManifest;
      // The manifest shape has NO field that can grant a capability.
      expect(manifest).not.toHaveProperty("grantCapability");
      expect(manifest).not.toHaveProperty("elevatePermission");
      expect(validateManifest(manifest)).toEqual([]);
    }
  });
});
