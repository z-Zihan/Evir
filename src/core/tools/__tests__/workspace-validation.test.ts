// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvirRuntime } from "../../../runtime/types";
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
    expect(localStorage.getItem("evir-workspace-current")).toBe("/tmp/my-project");
  });

  it("clears workspace", async () => {
    const { useWorkspaceStore } = await import("../../../features/workspace/workspace-store");
    useWorkspaceStore.getState().setWorkspace("/tmp/my-project");
    useWorkspaceStore.getState().clearWorkspace();
    expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
    expect(localStorage.getItem("evir-workspace-current")).toBeNull();
    useWorkspaceStore.getState().loadWorkspace();
    expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
    expect(useWorkspaceStore.getState().recentWorkspaces).toContain("/tmp/my-project");
  });
});
