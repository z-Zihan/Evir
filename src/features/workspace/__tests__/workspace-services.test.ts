import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChangeDiff, resolveWorkspacePath } from "../workspace-services";

const storageMock = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<string>>(),
  gitStatus: vi.fn<(root: string) => Promise<unknown>>(),
  gitDiff: vi.fn<(root: string, staged: boolean) => Promise<string>>(),
}));

vi.mock("../../../runtime/desktop-storage-adapter", () => ({
  desktopStorage: storageMock,
}));

function repoStatus(entries: Array<{ status: string; file: string }>) {
  return { is_repo: true, entries, branch: "main" };
}

beforeEach(() => {
  storageMock.readFile.mockReset();
  storageMock.gitStatus.mockReset();
  storageMock.gitDiff.mockReset();
});

describe("resolveChangeDiff", () => {
  it("resolves project-relative added files before reading them", async () => {
    storageMock.gitStatus.mockResolvedValue(repoStatus([{ status: "??", file: "report.md" }]));
    storageMock.gitDiff.mockResolvedValue("");
    storageMock.readFile.mockResolvedValue("# Report\n");

    const resolved = await resolveChangeDiff(
      { path: "report.md", changeType: "added" },
      "/tmp/demo",
    );

    expect(resolved.diff).toContain("+++ b/report.md");
    expect(storageMock.readFile).toHaveBeenCalledWith("/tmp/demo/report.md");
  });

  it("synthesizes a full-addition diff for untracked files recorded as modified", async () => {
    // Retried runs snapshot the earlier attempt's file, so the change lands
    // as "modified" while git never tracked it (`git diff` has no section).
    storageMock.gitStatus.mockResolvedValue(repoStatus([{ status: "??", file: "landing.html" }]));
    storageMock.gitDiff.mockResolvedValue("");
    storageMock.readFile.mockResolvedValue("<html>\nhi\n</html>\n");

    const resolved = await resolveChangeDiff(
      { path: "/tmp/demo/landing.html", changeType: "modified" },
      "/tmp/demo",
    );
    expect(resolved.diff).toContain("new file mode 100644");
    expect(resolved.diff).toContain("+++ b/landing.html");
    expect(storageMock.readFile).toHaveBeenCalledWith("/tmp/demo/landing.html");
  });

  it("keeps the empty no-section result for tracked files without a diff section", async () => {
    storageMock.gitStatus.mockResolvedValue(repoStatus([{ status: " M", file: "other.ts" }]));
    storageMock.gitDiff.mockResolvedValue("");

    const resolved = await resolveChangeDiff(
      { path: "/tmp/demo/app.ts", changeType: "modified" },
      "/tmp/demo",
    );
    expect(resolved).toEqual({ diff: "", reason: "no-section" });
    expect(storageMock.readFile).not.toHaveBeenCalled();
  });

  it("synthesizes added diffs outside a repo from file content", async () => {
    storageMock.readFile.mockResolvedValue("hello\n");

    const resolved = await resolveChangeDiff(
      { path: "/tmp/plain/new.txt", changeType: "added" },
      null,
    );
    expect(resolved.diff).toContain("+hello");
  });
});

describe("resolveWorkspacePath", () => {
  it("keeps absolute paths and resolves slash variants under the root", () => {
    expect(resolveWorkspacePath("/tmp/other.txt", "/tmp/demo")).toBe("/tmp/other.txt");
    expect(resolveWorkspacePath("src\\index.ts", "/tmp/demo/")).toBe("/tmp/demo/src/index.ts");
  });

  it("rejects relative paths that escape the workspace", () => {
    expect(resolveWorkspacePath("../secret.txt", "/tmp/demo")).toBeNull();
    expect(resolveWorkspacePath("relative.txt", null)).toBeNull();
  });
});
