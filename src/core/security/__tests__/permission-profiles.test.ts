import { describe, expect, it } from "vitest";

import {
  candidatePathFromArgs,
  isInsideRoots,
  resolveExecutionPermission,
} from "../permission-profiles";
import {
  validateToolForExecution,
  TOOL_PERMISSION_REQUIRED,
  TOOL_NOT_ALLOWED,
} from "../../tools/tool-executor";
import type { EvirRuntime } from "../../../runtime/types";
import type { ToolDefinition } from "../../providers/tool-registry";

const L3_TOOL: ToolDefinition = {
  id: "write_file",
  name: "write_file",
  description: "write",
  source: "evir-local",
  riskLevel: "L3",
  schema: { type: "object" },
  execute: () => Promise.resolve({ success: true, output: "" }),
};

const L1_TOOL: ToolDefinition = {
  id: "read_file",
  name: "read_file",
  description: "read",
  source: "evir-local",
  riskLevel: "L1",
  schema: { type: "object" },
  execute: () => Promise.resolve({ success: true, output: "" }),
};

function runtimeWith(context: EvirRuntime["permissionContext"]): EvirRuntime {
  return {
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: () => true,
    permissionContext: context,
  } as unknown as EvirRuntime;
}

const ROOTS = ["/projects/evir", "/projects/reference"];

describe("resolveExecutionPermission", () => {
  it("auto-approves read-only tools under every profile", () => {
    for (const profile of ["ask", "workspace", "full"] as const) {
      expect(resolveExecutionPermission({ profile, roots: ROOTS }, "L1", null).autoApproved).toBe(
        true,
      );
    }
  });

  it("ask profile always requires approval for writes", () => {
    expect(
      resolveExecutionPermission({ profile: "ask", roots: ROOTS }, "L3", "/projects/evir/a.txt"),
    ).toMatchObject({ autoApproved: false, reason: "ask-profile" });
  });

  it("workspace auto-approves inside granted roots and asks outside", () => {
    expect(
      resolveExecutionPermission(
        { profile: "workspace", roots: ROOTS },
        "L3",
        "/projects/evir/a.txt",
      ),
    ).toMatchObject({ autoApproved: true, reason: "within-workspace" });
    expect(
      resolveExecutionPermission(
        { profile: "workspace", roots: ROOTS },
        "L3",
        "/projects/evir/../other/a.txt",
      ).autoApproved,
    ).toBe(false);
    expect(
      resolveExecutionPermission({ profile: "workspace", roots: ROOTS }, "L3", "/etc/hosts"),
    ).toMatchObject({ autoApproved: false, reason: "outside-roots" });
    expect(
      resolveExecutionPermission({ profile: "workspace", roots: ROOTS }, "L3", null),
    ).toMatchObject({ autoApproved: false, reason: "unknown-path" });
  });

  it("full access auto-approves everywhere but cannot upgrade plan's read-only limit", () => {
    expect(
      resolveExecutionPermission({ profile: "full", roots: ROOTS }, "L3", "/somewhere/else"),
    ).toMatchObject({ autoApproved: true, reason: "full-access" });

    // Mode capability beats permission: plan mode rejects the write outright.
    expect(
      validateToolForExecution(
        L3_TOOL,
        "plan",
        runtimeWith({ profile: "full", roots: ROOTS }),
        false,
      ),
    ).toBe(TOOL_NOT_ALLOWED);
  });

  it("workspace profile still auto-approves L3 in agent mode inside roots", () => {
    expect(
      validateToolForExecution(
        L3_TOOL,
        "agent",
        runtimeWith({ profile: "workspace", roots: ROOTS }),
        false,
        { path: "/projects/evir/src/a.ts" },
      ),
    ).toBeNull();
    expect(
      validateToolForExecution(L3_TOOL, "agent", runtimeWith(null), false, { path: "/x" }),
    ).toBe(TOOL_PERMISSION_REQUIRED);
  });

  it("an approved call bypasses the profile question entirely", () => {
    expect(validateToolForExecution(L3_TOOL, "agent", runtimeWith(null), true)).toBeNull();
  });

  it("read-only tools never hit the approval path", () => {
    expect(validateToolForExecution(L1_TOOL, "agent", runtimeWith(null), false)).toBeNull();
  });
});

describe("path helpers", () => {
  it("checks root membership with boundary awareness", () => {
    expect(isInsideRoots("/projects/evir", ["/projects/evir"])).toBe(true);
    expect(isInsideRoots("/projects/evir/a.ts", ["/projects/evir"])).toBe(true);
    expect(isInsideRoots("/projects/evirage/a.ts", ["/projects/evir"])).toBe(false);
    expect(isInsideRoots("/projects/reference/x", ROOTS)).toBe(true);
  });

  it("extracts candidate paths from tool arguments", () => {
    expect(candidatePathFromArgs({ path: "/a" })).toBe("/a");
    expect(candidatePathFromArgs({ file_path: "/b" })).toBe("/b");
    expect(candidatePathFromArgs({ cwd: "/c" })).toBe("/c");
    expect(candidatePathFromArgs({ directory: "/d" })).toBe("/d");
    expect(candidatePathFromArgs({ query: "x" })).toBeNull();
    expect(candidatePathFromArgs({ path: 42 })).toBeNull();
  });
});
