// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvirRuntime } from "../../../runtime/types";
import type { PermissionContext } from "../../../core/security/permission-profiles";
import { validateWorkspacePath } from "../builtin/local-file-tools";

vi.mock("../../../core/tools/tool-executor", () => ({
  TOOL_NOT_AVAILABLE: "not_available_in_browser",
}));

// Test the path validation logic directly
function homeDir(): string {
  return "/home/user";
}

function validatePath(path: string): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/") && !/^[A-Za-z]:\\/.test(path)) return undefined;
  const resolved = path.replace(/\/+$/, "").replace(/\\/g, "/");
  if (resolved.split("/").some((segment) => segment === "..")) return undefined;
  const home = homeDir();
  const blockedPrefixes = [`${home}/.ssh`, "/etc", "/System", "/usr", "/bin", "/sbin", "/var"];
  for (const blocked of blockedPrefixes) {
    if (resolved === blocked || resolved.startsWith(`${blocked}/`)) return undefined;
  }
  return resolved;
}

describe("workspace path validation", () => {
  it("allows absolute paths inside workspace", () => {
    expect(validatePath("/tmp/project/src/index.ts")).toBe("/tmp/project/src/index.ts");
  });

  it("blocks relative paths", () => {
    expect(validatePath("relative/file.txt")).toBeUndefined();
  });

  it("blocks parent directory traversal", () => {
    expect(validatePath("/tmp/project/../etc/passwd")).toBeUndefined();
  });

  it("blocks sensitive system directories", () => {
    expect(validatePath("/etc/passwd")).toBeUndefined();
    expect(validatePath("/usr/bin/ls")).toBeUndefined();
    expect(validatePath("/System/Library")).toBeUndefined();
  });

  it("blocks .ssh directory", () => {
    expect(validatePath("/home/user/.ssh/id_rsa")).toBeUndefined();
  });

  it("allows paths with dots that are not parent traversal", () => {
    expect(validatePath("/tmp/project/.gitignore")).toBe("/tmp/project/.gitignore");
  });

  it("accepts spaces, Chinese, emoji, deep paths, and long filenames", () => {
    const longName = `${"a".repeat(180)}.txt`;
    for (const path of [
      "/tmp/project/folder with spaces/file.txt",
      "/tmp/project/中文目录/说明.md",
      "/tmp/project/emoji-😀/result.txt",
      `/tmp/project/${Array.from({ length: 20 }, (_, index) => `level-${index}`).join("/")}/file.txt`,
      `/tmp/project/${longName}`,
    ]) {
      expect(validatePath(path)).toBe(path);
    }
  });

  it("handles empty path", () => {
    expect(validatePath("")).toBeUndefined();
  });
});

describe("tool workspace boundary", () => {
  const runtime = {
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: () => true,
    getWorkspaceRoot: () => "/tmp/project",
  } as unknown as EvirRuntime;

  it("allows the workspace root and its descendants", () => {
    expect(validateWorkspacePath("/tmp/project", runtime)).toBe("/tmp/project");
    expect(validateWorkspacePath("/tmp/project/src/index.ts", runtime)).toBe(
      "/tmp/project/src/index.ts",
    );
  });

  it("resolves safe model-relative paths from the workspace root", () => {
    expect(validateWorkspacePath("input.txt", runtime)).toBe("/tmp/project/input.txt");
    expect(validateWorkspacePath(".", runtime)).toBe("/tmp/project");
    expect(validateWorkspacePath(".git/HEAD", runtime)).toBe("/tmp/project/.git/HEAD");
  });

  it("does not duplicate a workspace basename in a model-relative path", () => {
    expect(validateWorkspacePath("project/src/index.ts", runtime)).toBe(
      "/tmp/project/src/index.ts",
    );
    expect(validateWorkspacePath("project", runtime)).toBe("/tmp/project");
  });

  it("blocks traversal and absolute-looking paths from another platform", () => {
    expect(validateWorkspacePath("../outside.txt", runtime)).toBeUndefined();
    expect(validateWorkspacePath("src/../../outside.txt", runtime)).toBeUndefined();
    expect(validateWorkspacePath("C:\\outside.txt", runtime)).toBeUndefined();
  });

  it("blocks sibling prefixes and paths outside the selected workspace", () => {
    expect(validateWorkspacePath("/tmp/project-copy/file.ts", runtime)).toBeUndefined();
    expect(validateWorkspacePath("/tmp/other/file.ts", runtime)).toBeUndefined();
  });

  it("blocks all local paths when no workspace is selected", () => {
    const noWorkspace = { ...runtime, getWorkspaceRoot: () => null };
    expect(validateWorkspacePath("/tmp/project/file.ts", noWorkspace)).toBeUndefined();
  });

  it("resolves Windows relative paths case-insensitively", () => {
    const windowsRuntime = { ...runtime, getWorkspaceRoot: () => "C:\\Users\\Me\\Project" };
    expect(validateWorkspacePath("src\\index.ts", windowsRuntime)).toBe(
      "C:/Users/Me/Project/src/index.ts",
    );
    expect(validateWorkspacePath("project\\README.md", windowsRuntime)).toBe(
      "C:/Users/Me/Project/README.md",
    );
    expect(validateWorkspacePath("C:\\users\\me\\project\\src\\index.ts", windowsRuntime)).toBe(
      "C:/users/me/project/src/index.ts",
    );
  });
});

describe("permission context boundaries", () => {
  // validateWorkspacePath derives HOME from process.env at call time, so
  // sensitive-prefix assertions must use the real test-process home, not the
  // /home/user fixture of the standalone validatePath suite above.
  // Mirrors homeDir() in local-file-tools.ts: HOME first, USERPROFILE as the
  // Windows fallback (HOME is usually unset there), so HOME-anchored
  // assertions do not diverge when vitest runs on Windows.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/";
  const runtime = {
    target: "desktop",
    capabilities: new Set(["filesystem"]),
    has: () => true,
    getWorkspaceRoot: () => "/tmp/project",
  } as unknown as EvirRuntime;

  const withPermissionContext = (
    context: PermissionContext,
    base: EvirRuntime = runtime,
  ): EvirRuntime => ({ ...base, permissionContext: context });

  describe("full access profile", () => {
    const full = withPermissionContext({ profile: "full", roots: ["/tmp/project"] });

    it("allows paths outside the workspace the user granted explicitly", () => {
      expect(validateWorkspacePath("/tmp/other/file.ts", full)).toBe("/tmp/other/file.ts");
      expect(validateWorkspacePath(`${home}/Desktop/notes.txt`, full)).toBe(
        `${home}/Desktop/notes.txt`,
      );
    });

    it("still blocks HOME-anchored sensitive prefixes under full access", () => {
      expect(validateWorkspacePath(`${home}/.ssh/id_rsa`, full)).toBeUndefined();
      expect(validateWorkspacePath(`${home}/.gnupg`, full)).toBeUndefined();
      expect(validateWorkspacePath(`${home}/Library/Keychains`, full)).toBeUndefined();
      expect(validateWorkspacePath(`${home}/Library/Keychains/login.keychain`, full)).toBe(
        undefined,
      );
    });

    it("still blocks system directories under full access", () => {
      for (const path of [
        "/etc/passwd",
        "/System/Library",
        "/usr/bin/ls",
        "/bin/sh",
        "/sbin/mount",
        "/var/log/system.log",
        "/private/etc/hosts",
      ]) {
        expect(validateWorkspacePath(path, full)).toBeUndefined();
      }
    });

    it("still blocks parent traversal under full access", () => {
      expect(validateWorkspacePath("../outside.txt", full)).toBeUndefined();
      expect(validateWorkspacePath("src/../../outside.txt", full)).toBeUndefined();
    });
  });

  describe("granted roots", () => {
    it("keeps the workspace grant when roots include the workspace root", () => {
      const workspace = withPermissionContext({ profile: "workspace", roots: ["/tmp/project"] });
      expect(validateWorkspacePath("/tmp/project/file.ts", workspace)).toBe("/tmp/project/file.ts");
      expect(validateWorkspacePath("src/index.ts", workspace)).toBe("/tmp/project/src/index.ts");
      expect(validateWorkspacePath("/tmp/other/file.ts", workspace)).toBeUndefined();
    });

    it("withdraws the default workspace grant when roots exclude it", () => {
      const altOnly = withPermissionContext({ profile: "workspace", roots: ["/tmp/alt"] });
      expect(validateWorkspacePath("/tmp/project/file.ts", altOnly)).toBeUndefined();
      expect(validateWorkspacePath("src/index.ts", altOnly)).toBeUndefined();
      expect(validateWorkspacePath(".", altOnly)).toBeUndefined();
    });

    it("allows the granted root and its descendants, rejects sibling prefixes and outsiders", () => {
      const altOnly = withPermissionContext({ profile: "workspace", roots: ["/tmp/alt"] });
      expect(validateWorkspacePath("/tmp/alt", altOnly)).toBe("/tmp/alt");
      expect(validateWorkspacePath("/tmp/alt/file.ts", altOnly)).toBe("/tmp/alt/file.ts");
      expect(validateWorkspacePath("/tmp/alt/deep/nested.txt", altOnly)).toBe(
        "/tmp/alt/deep/nested.txt",
      );
      expect(validateWorkspacePath("/tmp/alt-copy/file.ts", altOnly)).toBeUndefined();
      expect(validateWorkspacePath("/tmp/other/file.ts", altOnly)).toBeUndefined();
    });

    it("allows a path when any of multiple granted roots matches", () => {
      const multi = withPermissionContext({
        profile: "workspace",
        roots: ["/tmp/project", "/tmp/alt2"],
      });
      expect(validateWorkspacePath("/tmp/project/file.ts", multi)).toBe("/tmp/project/file.ts");
      expect(validateWorkspacePath("/tmp/alt2", multi)).toBe("/tmp/alt2");
      expect(validateWorkspacePath("/tmp/alt2/output.bin", multi)).toBe("/tmp/alt2/output.bin");
      expect(validateWorkspacePath("/tmp/other/file.ts", multi)).toBeUndefined();
    });

    it("matches Windows roots case-insensitively", () => {
      const windowsRoot = { ...runtime, getWorkspaceRoot: () => "C:\\Users\\Me\\Project" };
      const granted = withPermissionContext(
        { profile: "workspace", roots: ["c:/users/me/project"] },
        windowsRoot,
      );
      expect(validateWorkspacePath("C:\\Users\\Me\\Project\\src\\index.ts", granted)).toBe(
        "C:/Users/Me/Project/src/index.ts",
      );
      const otherRoot = withPermissionContext(
        { profile: "workspace", roots: ["C:/Users/Other"] },
        windowsRoot,
      );
      expect(validateWorkspacePath("C:\\Users\\Me\\Project\\src\\index.ts", otherRoot)).toBe(
        undefined,
      );
    });
  });
});

describe("workspace store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with no workspace", async () => {
    const { useWorkspaceStore } = await import("../../../features/workspace/workspace-store");
    expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
  });

  it("sets and persists workspace", async () => {
    const { useWorkspaceStore } = await import("../../../features/workspace/workspace-store");
    useWorkspaceStore.getState().setWorkspace("/tmp/my-project");
    expect(useWorkspaceStore.getState().currentWorkspace).toBe("/tmp/my-project");
    expect(useWorkspaceStore.getState().recentWorkspaces).toContain("/tmp/my-project");
    expect(localStorage.getItem("evir-workspace-current::default")).toBe("/tmp/my-project");
  });

  it("clears workspace", async () => {
    const { useWorkspaceStore } = await import("../../../features/workspace/workspace-store");
    useWorkspaceStore.getState().setWorkspace("/tmp/my-project");
    useWorkspaceStore.getState().clearWorkspace();
    expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
    expect(localStorage.getItem("evir-workspace-current::default")).toBeFalsy();
    useWorkspaceStore.getState().loadWorkspace();
    expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
    expect(useWorkspaceStore.getState().recentWorkspaces).toContain("/tmp/my-project");
  });
});
