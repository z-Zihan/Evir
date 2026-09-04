import { describe, expect, it } from "vitest";
import {
  parseWorkspaceResource,
  workspaceResourceKey,
  workspaceResourceTitle,
} from "../resource-model";
import {
  deriveTaskOutput,
  deriveTaskOutputs,
  isArtifactPath,
  mergeTaskOutputs,
} from "../task-output-model";
import {
  countDiffLines,
  deriveChanges,
  filterUnifiedDiffByFile,
  synthesizeAddedDiff,
} from "../changes-model";
import type { ToolCallRecord, ToolResultRecord } from "../../../core/storage/db";
import type { SnapshotResult } from "../../../runtime/desktop-storage-adapter";

function call(id: string, toolName: string, args: Record<string, unknown>): ToolCallRecord {
  return { id, toolName, arguments: args };
}

function result(id: string, toolName: string, success = true, output = "ok"): ToolResultRecord {
  return { toolCallId: id, toolName, success, output, completedAt: 1_000 };
}

function snapshot(path: string, existed: boolean): SnapshotResult {
  return { snapshot_id: `s-${path}`, file_path: path, existed, original_hash: null };
}

const CONTEXT = { runId: "run-1", conversationId: "c-1" };

describe("workspace resource model", () => {
  it("parses valid resources and rejects malformed ones", () => {
    expect(parseWorkspaceResource({ kind: "file", path: "/tmp/a.txt" })).toEqual({
      kind: "file",
      path: "/tmp/a.txt",
    });
    expect(parseWorkspaceResource({ kind: "url", uri: "http://localhost:5173" })).toEqual({
      kind: "url",
      uri: "http://localhost:5173",
    });
    expect(parseWorkspaceResource({ kind: "file", path: "" })).toBeNull();
    expect(parseWorkspaceResource({ kind: "wat", path: "/x" })).toBeNull();
    expect(parseWorkspaceResource("nope")).toBeNull();
  });

  it("derives stable identity keys for history and pinning", () => {
    expect(workspaceResourceKey({ kind: "file", path: "/a/b.ts" })).toBe("file:/a/b.ts");
    expect(workspaceResourceKey({ kind: "diff", path: "/a/b.ts" })).not.toBe(
      workspaceResourceKey({ kind: "file", path: "/a/b.ts" }),
    );
    expect(workspaceResourceKey({ kind: "artifact", artifactId: "x", language: "html" })).toBe(
      "artifact:x",
    );
  });

  it("builds short display titles", () => {
    expect(workspaceResourceTitle({ kind: "file", path: "/proj/src/App.tsx" })).toBe("src/App.tsx");
    expect(workspaceResourceTitle({ kind: "url", uri: "https://example.com/page" })).toBe(
      "example.com/page",
    );
  });
});

describe("task output classification", () => {
  it("classifies created document files as outputs", () => {
    const output = deriveTaskOutput(
      call("t1", "write_file", { path: "/p/report.html" }),
      result("t1", "write_file"),
      { ...CONTEXT, newSnapshots: [snapshot("/p/report.html", false)] },
    );
    expect(output).toMatchObject({ kind: "created-file", type: "html", mimeType: "text/html" });
  });

  it("matches relative tool paths to absolute creation snapshots", () => {
    const output = deriveTaskOutput(
      call("relative", "write_file", { path: "reports/result.md" }),
      result("relative", "write_file"),
      { ...CONTEXT, newSnapshots: [snapshot("/p/reports/result.md", false)] },
    );
    expect(output).toMatchObject({
      kind: "created-file",
      path: "/p/reports/result.md",
      type: "md",
    });
  });

  it("does not classify created source files as outputs", () => {
    const output = deriveTaskOutput(
      call("t2", "write_file", { path: "/p/src/Button.tsx" }),
      result("t2", "write_file"),
      { ...CONTEXT, newSnapshots: [snapshot("/p/src/Button.tsx", false)] },
    );
    expect(output).toBeNull();
  });

  it("does not classify modified artifacts as outputs", () => {
    const output = deriveTaskOutput(
      call("t3", "write_file", { path: "/p/index.html" }),
      result("t3", "write_file"),
      { ...CONTEXT, newSnapshots: [snapshot("/p/index.html", true)] },
    );
    expect(output).toBeNull();
  });

  it("captures browser screenshots from real tool output", () => {
    const output = deriveTaskOutput(
      call("t4", "browser_screenshot", {}),
      result("t4", "browser_screenshot", true, JSON.stringify({ path: "/shots/1.png" })),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toMatchObject({ kind: "screenshot", type: "png", path: "/shots/1.png" });
  });

  it("ignores failed calls and malformed screenshot payloads", () => {
    expect(
      deriveTaskOutput(
        call("t5", "write_file", { path: "/p/a.md" }),
        result("t5", "write_file", false),
        {
          ...CONTEXT,
          newSnapshots: [snapshot("/p/a.md", false)],
        },
      ),
    ).toBeNull();
    expect(
      deriveTaskOutput(
        call("t6", "browser_screenshot", {}),
        result("t6", "browser_screenshot", true, "not json"),
        {
          ...CONTEXT,
          newSnapshots: [],
        },
      ),
    ).toBeNull();
  });

  it("re-derivation dedupes repeated writes of the same file", () => {
    const calls = [
      call("a", "write_file", { path: "/p/landing.html" }),
      call("b", "write_file", { path: "/p/landing.html" }),
    ];
    const results = [result("a", "write_file"), result("b", "write_file")];
    const outputs = deriveTaskOutputs(
      calls,
      results,
      [snapshot("/p/landing.html", false)],
      CONTEXT,
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.path).toBe("/p/landing.html");
  });

  it("attributes report_output registrations as reported outputs", () => {
    const output = deriveTaskOutput(
      call("t7", "report_output", { path: "photo.png" }),
      result(
        "t7",
        "report_output",
        true,
        JSON.stringify({ reported: true, path: "/proj/photo.png", size: 900 }),
      ),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toMatchObject({
      kind: "reported",
      type: "png",
      path: "/proj/photo.png",
      mimeType: "image/png",
      sourceTool: "report_output",
    });
  });

  it("falls back to the binary type for reported files without a known extension", () => {
    const output = deriveTaskOutput(
      call("t8", "report_output", { path: "deliverable" }),
      result(
        "t8",
        "report_output",
        true,
        JSON.stringify({ reported: true, path: "/proj/deliverable", size: 10 }),
      ),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toMatchObject({ kind: "reported", type: "binary" });
    expect(output?.mimeType).toBe("application/octet-stream");
  });

  it("ignores report_output results without a valid evidence payload", () => {
    expect(
      deriveTaskOutput(
        call("t9", "report_output", { path: "photo.png" }),
        result("t9", "report_output", false, "reported output not found: photo.png"),
        { ...CONTEXT, newSnapshots: [] },
      ),
    ).toBeNull();
    expect(
      deriveTaskOutput(
        call("t10", "report_output", { path: "photo.png" }),
        result("t10", "report_output", true, "ok"),
        { ...CONTEXT, newSnapshots: [] },
      ),
    ).toBeNull();
  });

  it("dedupes repeated reports of the same path within one run", () => {
    const payload = JSON.stringify({ reported: true, path: "/proj/data.csv", size: 5 });
    const outputs = deriveTaskOutputs(
      [
        call("r1", "report_output", { path: "data.csv" }),
        call("r2", "report_output", { path: "data.csv" }),
      ],
      [result("r1", "report_output", true, payload), result("r2", "report_output", true, payload)],
      [],
      CONTEXT,
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.type).toBe("csv");
  });

  it("merges outputs by id across approval continuations", () => {
    const first = deriveTaskOutputs(
      [call("a", "write_file", { path: "/p/x.svg" })],
      [result("a", "write_file")],
      [snapshot("/p/x.svg", false)],
      CONTEXT,
    );
    expect(mergeTaskOutputs(first, first)).toHaveLength(1);
  });

  it("artifact extension detection covers document families", () => {
    expect(isArtifactPath("/a/b.html")).toBe(true);
    expect(isArtifactPath("/a/b.PDF")).toBe(true);
    expect(isArtifactPath("/a/vl.json")).toBe(true);
    expect(isArtifactPath("/a/b.ts")).toBe(false);
    expect(isArtifactPath("/a/b.tsx")).toBe(false);
    expect(isArtifactPath("/a/.html")).toBe(false);
  });
});

describe("changes derivation", () => {
  it("derives added vs modified from snapshot existence", () => {
    const changes = deriveChanges(
      [
        call("c1", "write_file", { path: "/p/new.html" }),
        call("c2", "apply_patch", { path: "/p/old.ts" }),
      ],
      [result("c1", "write_file"), result("c2", "apply_patch")],
      [snapshot("/p/new.html", false), snapshot("/p/old.ts", true)],
      "run-1",
    );
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.path === "/p/new.html")?.changeType).toBe("added");
    expect(changes.find((c) => c.path === "/p/old.ts")?.changeType).toBe("modified");
  });

  it("uses the absolute snapshot path for relative tool arguments", () => {
    const changes = deriveChanges(
      [call("relative", "write_file", { path: "report.md" })],
      [result("relative", "write_file")],
      [snapshot("/p/report.md", true)],
      "run-1",
    );
    expect(changes).toEqual([
      expect.objectContaining({ path: "/p/report.md", changeType: "modified" }),
    ]);
  });

  it("keeps a created file 'added' across later edits in the same run", () => {
    const changes = deriveChanges(
      [
        call("c1", "write_file", { path: "/p/new.ts" }),
        call("c2", "write_file", { path: "/p/new.ts" }),
      ],
      [result("c1", "write_file"), result("c2", "write_file")],
      [snapshot("/p/new.ts", false)],
      "run-1",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.changeType).toBe("added");
  });

  it("ignores reads and failed writes", () => {
    const changes = deriveChanges(
      [call("r1", "read_file", { path: "/p/a" }), call("w1", "write_file", { path: "/p/b" })],
      [result("r1", "read_file"), result("w1", "write_file", false)],
      [],
      "run-1",
    );
    expect(changes).toHaveLength(0);
  });
});

describe("unified diff helpers", () => {
  const diff = [
    "diff --git a/src/App.tsx b/src/App.tsx",
    "index 111..222 100644",
    "--- a/src/App.tsx",
    "+++ b/src/App.tsx",
    "@@ -1,2 +1,3 @@",
    " old",
    "-removed",
    "+added",
    "+added2",
    "diff --git a/页面 文件.html b/页面 文件.html",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/页面 文件.html",
    "@@ -0,0 +1,1 @@",
    "+你好",
  ].join("\n");

  it("filters a section by plain relative path", () => {
    const section = filterUnifiedDiffByFile(diff, "src/App.tsx");
    expect(section).toContain("+++ b/src/App.tsx");
    expect(section).not.toContain("页面");
  });

  it("matches quoted non-ASCII paths", () => {
    const section = filterUnifiedDiffByFile(diff, "页面 文件.html");
    expect(section).toContain("你好");
  });

  it("returns empty for files without a section", () => {
    expect(filterUnifiedDiffByFile(diff, "src/Other.tsx")).toBe("");
  });

  it("synthesizes a full-addition diff for created files", () => {
    const synthesized = synthesizeAddedDiff("/p/index.html", "<html>\nbody\n</html>\n");
    expect(synthesized).toContain("new file mode 100644");
    expect(synthesized).toContain("@@ -0,0 +1,3 @@");
    expect(
      synthesized.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")),
    ).toHaveLength(3);
  });

  it("counts additions and deletions excluding headers", () => {
    expect(countDiffLines(diff)).toEqual({ additions: 3, deletions: 1 });
  });
});
