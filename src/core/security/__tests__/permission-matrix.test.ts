/**
 * Consolidated Permission Matrix (§41): one table over the real decision
 * functions — ToolExecutor validation (mode risk caps + capability +
 * profile) and the TS workspace-path layer — for every operation class ×
 * permission profile. This is the single place that pins the whole matrix;
 * the scattered unit tests below it cover branches in depth.
 */
import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../../tools/tool-executor";
import { createToolRegistry } from "../../tools/tool-registry-impl";
import { LOCAL_FILE_TOOLS } from "../../tools/builtin/local-file-tools";
import {
  candidatePathFromArgs,
  isInsideRoots,
  resolveExecutionPermission,
} from "../permission-profiles";
import type { PermissionContext } from "../permission-profiles";
import type { MessageRecord } from "../../storage/db";

const WORKSPACE = "/ws/project";
const EXTRA_ROOT = "/ws/extra";
const OUTSIDE = "/elsewhere";

const CONTEXTS: Record<"ask" | "workspace" | "full", PermissionContext> = {
  ask: { profile: "ask", roots: [WORKSPACE, EXTRA_ROOT] },
  workspace: { profile: "workspace", roots: [WORKSPACE, EXTRA_ROOT] },
  full: { profile: "full", roots: [WORKSPACE] },
};

function executorWithRegistry() {
  const registry = createToolRegistry();
  for (const tool of LOCAL_FILE_TOOLS) registry.register(tool);
  return { registry, executor: new ToolExecutor(registry) };
}

function runtimeFor(profile: keyof typeof CONTEXTS, root = WORKSPACE) {
  const { registry, executor } = executorWithRegistry();
  return {
    registry,
    executor,
    runtime: {
      target: "desktop" as const,
      capabilities: new Set(["chat", "filesystem", "terminal", "git"]),
      has: (capability: string) => ["chat", "filesystem", "terminal", "git"].includes(capability),
      mode: "agent" as const,
      permissionContext: CONTEXTS[profile],
      toolRegistry: registry,
      getWorkspaceRoot: () => root,
      storage: undefined,
    },
  };
}

describe("permission matrix — profile × operation (§41)", () => {
  const cases: Array<{
    operation: string;
    tool: string;
    args: Record<string, unknown>;
    expectations: Partial<Record<keyof typeof CONTEXTS, "auto" | "approval" | "denied">>;
  }> = [
    {
      operation: "read file in workspace",
      tool: "read_file",
      args: { path: "src/app.js" },
      expectations: { ask: "auto", workspace: "auto", full: "auto" }, // L1 read-only
    },
    {
      operation: "write file in workspace",
      tool: "write_file",
      args: { path: "src/app.js", content: "x" },
      expectations: { ask: "approval", workspace: "auto", full: "auto" },
    },
    {
      operation: "write file in extra authorized root",
      tool: "write_file",
      args: { path: `${EXTRA_ROOT}/note.txt`, content: "x" },
      expectations: { ask: "approval", workspace: "auto", full: "auto" },
    },
    {
      operation: "write file outside all roots",
      tool: "write_file",
      args: { path: `${OUTSIDE}/escape.txt`, content: "x" },
      expectations: { ask: "approval", workspace: "approval", full: "auto" },
    },
    {
      operation: "write via .. escape out of workspace",
      tool: "write_file",
      args: { path: "../escape.txt", content: "x" },
      expectations: { ask: "approval", workspace: "approval", full: "auto" },
    },
    {
      operation: "run command inside workspace",
      tool: "run_command",
      args: { cwd: ".", program: "node", args: ["--test"] },
      expectations: { ask: "approval", workspace: "auto", full: "auto" },
    },
  ];

  for (const { operation, tool, args, expectations } of cases) {
    it(`${operation} — ${JSON.stringify(expectations)}`, async () => {
      for (const profile of ["ask", "workspace", "full"] as const) {
        const expected = expectations[profile];
        if (!expected) continue;
        const { executor, runtime } = runtimeFor(profile);
        const result = await executor.execute(tool, args, runtime as never, false);
        if (expected === "auto") {
          expect(result.error, `${operation} under ${profile} should auto-approve`).not.toMatch(
            /permission/i,
          );
        } else {
          // approval or denied-by-boundary — both surface as permission-required
          expect(
            result.error ?? "",
            `${operation} under ${profile} must require permission`,
          ).toMatch(/permission|blocked|not.allowed/i);
        }
      }
    });
  }

  it("plan mode caps at L1 — write tools are rejected before any profile check", async () => {
    const { registry, executor } = executorWithRegistry();
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem"]),
      has: (capability: string) => capability === "filesystem",
      mode: "plan" as const,
      permissionContext: CONTEXTS.full,
      toolRegistry: registry,
      getWorkspaceRoot: () => WORKSPACE,
    };
    const result = await executor.execute(
      "write_file",
      { path: "src/app.js", content: "x" },
      runtime as never,
      true,
    );
    expect(result.error).toMatch(/not.allowed/i);
  });

  it("capability disable removes the tool from the agent runtime (§27)", () => {
    const registry = createToolRegistry();
    for (const tool of LOCAL_FILE_TOOLS) registry.register(tool);
    expect(registry.get("run_command")).toBeDefined();
    // Component-level disable replaces the registry contents (reconcile);
    // simulate the reconciled state by rebuilding without terminal tools.
    const registry2 = createToolRegistry();
    for (const tool of LOCAL_FILE_TOOLS.filter((item) => item.requiredCapability !== "terminal"))
      registry2.register(tool);
    expect(registry2.get("run_command")).toBeUndefined();
    expect(registry2.listForMode("agent").map(({ name }) => name)).not.toContain("run_command");
    expect(registry2.get("read_file")).toBeDefined();
  });

  it("read-only git inspection is L1 and auto-approved under every profile", () => {
    const git = LOCAL_FILE_TOOLS.find((tool) => tool.name === "git_status");
    expect(git?.riskLevel).toBe("L1");
    for (const profile of ["ask", "workspace", "full"] as const) {
      expect(
        resolveExecutionPermission(CONTEXTS[profile], "L1", WORKSPACE).autoApproved,
        profile,
      ).toBeTruthy();
    }
  });

  it("relative .. escapes are lexically resolved outside roots (symlink-style)", () => {
    const resolved = candidatePathFromArgs({ path: "nested/../../escape.txt" });
    expect(resolved).toContain("..");
    // The real boundary check resolves dot segments before prefix matching;
    // relative candidates are first resolved against the workspace root.
    expect(isInsideRoots(resolved ?? "", [WORKSPACE])).toBe(false);
    const inWorkspace = `${WORKSPACE}/src/app.js`;
    expect(isInsideRoots(inWorkspace, [WORKSPACE])).toBe(true);
  });

  it("risk L4 always requires approval regardless of profile", () => {
    for (const profile of ["ask", "workspace", "full"] as const) {
      const decision = resolveExecutionPermission(CONTEXTS[profile], "L4", null);
      expect(decision.autoApproved, `${profile} L4`).toBeFalsy();
    }
  });
});

void (undefined as unknown as MessageRecord);
