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

const L4_TOOL: ToolDefinition = {
  id: "publish_release",
  name: "publish_release",
  description: "publish",
  source: "evir-local",
  riskLevel: "L4",
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

  it("a scoped tool grant auto-approves that tool's L2/L3 calls inside the roots", () => {
    const granted = {
      profile: "ask" as const,
      roots: ROOTS,
      grantedTools: new Set(["apply_patch"]),
    };
    expect(
      resolveExecutionPermission(granted, "L3", "/projects/evir/a.txt", "apply_patch"),
    ).toMatchObject({ autoApproved: true, reason: "scoped-grant" });
    // No path to bound (e.g. run_command without an explicit cwd): granted.
    expect(resolveExecutionPermission(granted, "L3", null, "apply_patch")).toMatchObject({
      autoApproved: true,
      reason: "scoped-grant",
    });
    // Other tools still ask.
    expect(
      resolveExecutionPermission(granted, "L3", "/projects/evir/a.txt", "write_file"),
    ).toMatchObject({ autoApproved: false, reason: "ask-profile" });
    // Outside the granted roots, the grant must not apply.
    expect(
      resolveExecutionPermission(granted, "L3", "/projects/other/a.txt", "apply_patch"),
    ).toMatchObject({ autoApproved: false, reason: "ask-profile" });
  });

  it("a scoped grant never covers L4 and never bypasses workspace boundary refusals", () => {
    const granted = { profile: "ask" as const, roots: ROOTS, grantedTools: new Set(["publish"]) };
    expect(resolveExecutionPermission(granted, "L4", null, "publish").autoApproved).toBe(false);
    const workspace = {
      profile: "workspace" as const,
      roots: ROOTS,
      grantedTools: new Set(["write_file"]),
    };
    expect(resolveExecutionPermission(workspace, "L3", "/etc/hosts", "write_file")).toMatchObject({
      autoApproved: false,
      reason: "outside-roots",
    });
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

  it("never auto-approves L4 operations under any permission profile", () => {
    for (const profile of ["ask", "workspace", "full"] as const) {
      const context = { profile, roots: ROOTS };
      expect(resolveExecutionPermission(context, "L4", "/projects/evir/release")).toMatchObject({
        autoApproved: false,
      });
      expect(
        validateToolForExecution(L4_TOOL, "agent", runtimeWith(context), false, {
          path: "/projects/evir/release",
        }),
      ).toBe(TOOL_PERMISSION_REQUIRED);
    }
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

  // --- cross-platform boundary (§32-§35): deterministic Windows semantics ---
  // These are pure lexical tests — Windows NATIVE execution remains NOT RUN
  // and must never be claimed from this file alone.

  it("windows drive paths: separators, case, and prefix siblings", () => {
    expect(isInsideRoots("C:\\Users\\A\\Project", ["C:\\Users\\A\\Project"])).toBe(true);
    expect(isInsideRoots("C:\\Users\\A\\Project\\docs\\a.md", ["C:\\Users\\A\\Project"])).toBe(
      true,
    );
    // Mixed slash separators still land inside the same root.
    expect(isInsideRoots("C:/Users/A/Project/docs/a.md", ["C:\\Users\\A\\Project"])).toBe(true);
    // Drive-letter case and path case are folded (Windows is case-insensitive).
    expect(isInsideRoots("c:\\users\\a\\PROJECT\\Docs\\A.MD", ["C:\\Users\\A\\Project"])).toBe(
      true,
    );
    // A sibling directory with a shared prefix must NOT count as inside.
    expect(isInsideRoots("C:\\Users\\A\\Project2\\x.md", ["C:\\Users\\A\\Project"])).toBe(false);
    expect(isInsideRoots("C:\\Users\\A\\Project", ["C:\\Users\\A\\Project2"])).toBe(false);
  });

  it("windows traversal strings cannot escape the root", () => {
    expect(
      isInsideRoots("C:\\Users\\A\\Project\\..\\Secret\\k.txt", ["C:\\Users\\A\\Project"]),
    ).toBe(false);
    expect(isInsideRoots("C:/Users/A/Project/../Secret/k.txt", ["C:/Users/A/Project"])).toBe(false);
    expect(isInsideRoots("C:\\Users\\A\\Project\\.\\docs\\a.md", ["C:\\Users\\A\\Project"])).toBe(
      true,
    );
  });

  it("UNC paths compare within their own share root", () => {
    expect(isInsideRoots("\\\\server\\share\\docs\\a.md", ["\\\\server\\share"])).toBe(true);
    expect(isInsideRoots("\\\\server\\share2\\a.md", ["\\\\server\\share"])).toBe(false);
    expect(isInsideRoots("\\\\other\\share\\a.md", ["\\\\server\\share"])).toBe(false);
  });

  it("posix semantics are unchanged: backslash is NOT a separator on posix paths", () => {
    expect(isInsideRoots("/projects/evir/a.ts", ["/projects/evir"])).toBe(true);
    // `evir\..\other` is ONE literal segment name on POSIX — the path sits in
    // /projects, not inside /projects/evir (no backslash traversal semantics).
    expect(isInsideRoots("/projects/evir\\..\\other", ["/projects/evir"])).toBe(false);
    expect(isInsideRoots("/projects/evir\\..\\other", ["/projects"])).toBe(true);
    expect(isInsideRoots("/Projects/Evir/a.ts", ["/projects/evir"])).toBe(false); // case-sensitive
  });
});
