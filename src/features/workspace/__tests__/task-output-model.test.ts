import { describe, expect, it, vi } from "vitest";
import {
  deriveTaskOutput,
  deriveTaskOutputs,
  extensionOf,
  isArtifactPath,
  mergeTaskOutputs,
  mimeTypeForPath,
  type TaskOutput,
} from "../task-output-model";
import type { ToolCallRecord, ToolResultRecord } from "../../../core/storage/db";
import type { SnapshotResult } from "../../../runtime/desktop-storage-adapter";

function makeCall(id: string, toolName: string, args: Record<string, unknown>): ToolCallRecord {
  return { id, toolName, arguments: args };
}

function makeResult(
  callId: string,
  toolName: string,
  output: string,
  overrides: { success?: boolean; completedAt?: number | null } = {},
): ToolResultRecord {
  const { success = true, completedAt = 1_000 } = overrides;
  return {
    toolCallId: callId,
    toolName,
    success,
    output,
    ...(completedAt === null ? {} : { completedAt }),
    error: success ? "" : "tool failed",
    exitCode: success ? 0 : 1,
    startedAt: 900,
    durationMs: 100,
  };
}

function makeSnapshot(path: string, existed: boolean): SnapshotResult {
  return {
    snapshot_id: `snap-${path}`,
    file_path: path,
    existed,
    original_hash: existed ? "sha-abc" : null,
  };
}

function makeOutput(id: string, createdAt: number, extra: Partial<TaskOutput> = {}): TaskOutput {
  return {
    id,
    runId: "run-1",
    conversationId: "conv-1",
    kind: "created-file",
    type: "txt",
    path: `/p/${id}.txt`,
    mimeType: "text/plain",
    sourceTool: "write_file",
    createdAt,
    ...extra,
  };
}

const CONTEXT = { runId: "run-1", conversationId: "conv-1" };

describe("extensionOf", () => {
  it("extracts the plain extension from a basename", () => {
    expect(extensionOf("/p/src/report.pdf")).toBe("pdf");
    expect(extensionOf("notes.txt")).toBe("txt");
  });

  it("classifies a basename of exactly vl.json before the generic json extension", () => {
    expect(extensionOf("/charts/vl.json")).toBe("vl.json");
    // The special case is checked after lowercasing, so case cannot dodge it.
    expect(extensionOf("/charts/VL.JSON")).toBe("vl.json");
  });

  it("treats leading-dot files as dotfiles, not extensions", () => {
    expect(extensionOf("/p/.html")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("returns an empty extension when the name has no dot", () => {
    expect(extensionOf("/p/Makefile")).toBe("");
  });

  it("normalizes windows separators and lowercases the extension", () => {
    expect(extensionOf("C:\\proj\\out\\report.PDF")).toBe("pdf");
  });

  it("uses the last dot of a multi-dot filename", () => {
    expect(extensionOf("/p/archive.tar.gz")).toBe("gz");
    // Only an exact "vl.json" basename is special; prefixed names fall back
    // to the generic last-dot rule.
    expect(extensionOf("/p/chart.vl.json")).toBe("json");
  });
});

describe("mimeTypeForPath", () => {
  it("resolves extensions present in the MIME table", () => {
    expect(mimeTypeForPath("/p/index.html")).toBe("text/html");
    expect(mimeTypeForPath("/p/data.csv")).toBe("text/csv");
    expect(mimeTypeForPath("/p/photo.PNG")).toBe("image/png");
  });

  it("returns undefined for unknown extensions and dotfiles", () => {
    expect(mimeTypeForPath("/p/data.xyz")).toBeUndefined();
    expect(mimeTypeForPath("/p/Makefile")).toBeUndefined();
    expect(mimeTypeForPath("/p/.html")).toBeUndefined();
  });

  it("has no MIME entry for the vl.json special case", () => {
    // "vl.json" is an artifact extension but not a MIME table key.
    expect(mimeTypeForPath("/p/vl.json")).toBeUndefined();
  });
});

describe("isArtifactPath", () => {
  it("accepts document and artifact extensions", () => {
    expect(isArtifactPath("/p/report.html")).toBe(true);
    expect(isArtifactPath("/p/Report.PDF")).toBe(true);
    expect(isArtifactPath("/p/vl.json")).toBe(true);
    expect(isArtifactPath("/p/chart.vl.json")).toBe(true); // via plain "json"
    expect(isArtifactPath("/p/board.evir-canvas")).toBe(true);
  });

  it("rejects source code and dotfiles", () => {
    expect(isArtifactPath("/p/src/App.tsx")).toBe(false);
    expect(isArtifactPath("/p/src/Button.jsx")).toBe(false);
    expect(isArtifactPath("/p/src/.html")).toBe(false);
  });
});

describe("deriveTaskOutput", () => {
  it("returns null for failed results before any tool dispatch", () => {
    expect(
      deriveTaskOutput(
        makeCall("w0", "write_file", { path: "/p/report.html" }),
        makeResult("w0", "write_file", "ok", { success: false }),
        { ...CONTEXT, newSnapshots: [makeSnapshot("/p/report.html", false)] },
      ),
    ).toBeNull();
    expect(
      deriveTaskOutput(
        makeCall("r0", "report_output", { path: "a.png" }),
        makeResult(
          "r0",
          "report_output",
          JSON.stringify({ reported: true, path: "/p/a.png", size: 1 }),
          { success: false },
        ),
        { ...CONTEXT, newSnapshots: [] },
      ),
    ).toBeNull();
  });

  it("derives a reported output from a valid report_output payload", () => {
    const output = deriveTaskOutput(
      makeCall("rep-1", "report_output", { path: "summary.pdf" }),
      makeResult(
        "rep-1",
        "report_output",
        JSON.stringify({ reported: true, path: "/proj/out/summary.pdf", size: 2_048 }),
      ),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toEqual({
      id: "run-1:rep-1",
      runId: "run-1",
      conversationId: "conv-1",
      kind: "reported",
      type: "pdf",
      path: "/proj/out/summary.pdf",
      mimeType: "application/pdf",
      sourceTool: "report_output",
      createdAt: 1_000,
    });
  });

  it("falls back to binary/octet-stream for reported files without a known extension", () => {
    const output = deriveTaskOutput(
      makeCall("rep-2", "report_output", { path: "deliverable" }),
      makeResult(
        "rep-2",
        "report_output",
        JSON.stringify({ reported: true, path: "/proj/deliverable", size: 10 }),
      ),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toMatchObject({ kind: "reported", type: "binary" });
    expect(output?.mimeType).toBe("application/octet-stream");
  });

  it("defaults createdAt to Date.now when completedAt is absent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    try {
      const output = deriveTaskOutput(
        makeCall("rep-3", "report_output", {}),
        makeResult(
          "rep-3",
          "report_output",
          JSON.stringify({ reported: true, path: "/p/a.png", size: 1 }),
          { completedAt: null },
        ),
        { ...CONTEXT, newSnapshots: [] },
      );
      expect(output?.createdAt).toBe(new Date("2026-11-07T12:00:00Z").getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects report_output payloads that are not valid evidence", () => {
    const cases = [
      "not json {", // unparseable output
      "", // empty output parses as {} and fails the schema
      JSON.stringify({ reported: false, path: "/p/a.png", size: 1 }),
      JSON.stringify({ path: "/p/a.png", size: 1 }), // missing reported
      JSON.stringify({ reported: true, size: 1 }), // missing path
      JSON.stringify({ reported: true, path: "", size: 1 }), // empty path
      JSON.stringify({ reported: true, path: "/p/a.png", size: -1 }), // negative size
    ];
    for (const output of cases) {
      expect(
        deriveTaskOutput(
          makeCall("rep-x", "report_output", {}),
          makeResult("rep-x", "report_output", output),
          { ...CONTEXT, newSnapshots: [] },
        ),
      ).toBeNull();
    }
  });

  it("derives a canvas output from create_canvas with a title", () => {
    const output = deriveTaskOutput(
      makeCall("cv-1", "create_canvas", { path: "/p/board.evir-canvas" }),
      makeResult(
        "cv-1",
        "create_canvas",
        JSON.stringify({ path: "/p/board.evir-canvas", title: "Roadmap" }),
      ),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toEqual({
      id: "run-1:cv-1",
      runId: "run-1",
      conversationId: "conv-1",
      kind: "canvas",
      type: "canvas",
      path: "/p/board.evir-canvas",
      mimeType: "application/json",
      sourceTool: "create_canvas",
      createdAt: 1_000,
    });
  });

  it("derives a canvas output from update_canvas with path only", () => {
    const output = deriveTaskOutput(
      makeCall("cv-2", "update_canvas", {}),
      makeResult("cv-2", "update_canvas", JSON.stringify({ path: "/p/board2.evir-canvas" })),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toMatchObject({
      id: "run-1:cv-2",
      kind: "canvas",
      type: "canvas",
      path: "/p/board2.evir-canvas",
      mimeType: "application/json",
      sourceTool: "update_canvas",
    });
  });

  it("rejects invalid canvas payloads", () => {
    for (const output of ["not json {", "", JSON.stringify({ title: "no path" })]) {
      expect(
        deriveTaskOutput(
          makeCall("cv-x", "create_canvas", {}),
          makeResult("cv-x", "create_canvas", output),
          { ...CONTEXT, newSnapshots: [] },
        ),
      ).toBeNull();
    }
  });

  it("derives a screenshot output with png type", () => {
    const output = deriveTaskOutput(
      makeCall("shot-1", "browser_screenshot", {}),
      makeResult("shot-1", "browser_screenshot", JSON.stringify({ path: "/shots/home.png" })),
      { ...CONTEXT, newSnapshots: [] },
    );
    expect(output).toEqual({
      id: "run-1:shot-1",
      runId: "run-1",
      conversationId: "conv-1",
      kind: "screenshot",
      type: "png",
      path: "/shots/home.png",
      mimeType: "image/png",
      sourceTool: "browser_screenshot",
      createdAt: 1_000,
    });
  });

  it("rejects screenshot payloads without a path", () => {
    for (const output of ["not json {", JSON.stringify({}), JSON.stringify({ path: "" })]) {
      expect(
        deriveTaskOutput(
          makeCall("shot-x", "browser_screenshot", {}),
          makeResult("shot-x", "browser_screenshot", output),
          { ...CONTEXT, newSnapshots: [] },
        ),
      ).toBeNull();
    }
  });

  it("reads the target path from path, then file_path", () => {
    const viaPath = deriveTaskOutput(
      makeCall("w-a", "write_file", { path: "/p/via-path.html" }),
      makeResult("w-a", "write_file", "ok"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/p/via-path.html", false)] },
    );
    expect(viaPath).toMatchObject({ kind: "created-file", path: "/p/via-path.html" });

    const viaFilePath = deriveTaskOutput(
      makeCall("p-a", "apply_patch", { file_path: "/p/via-file-path.md" }),
      makeResult("p-a", "apply_patch", "ok"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/p/via-file-path.md", false)] },
    );
    expect(viaFilePath).toMatchObject({ kind: "created-file", path: "/p/via-file-path.md" });

    // "path" wins when both keys are present; an empty string falls through.
    const both = deriveTaskOutput(
      makeCall("w-b", "write_file", {
        path: "/p/primary.html",
        file_path: "/p/secondary.md",
      }),
      makeResult("w-b", "write_file", "ok"),
      {
        ...CONTEXT,
        newSnapshots: [
          makeSnapshot("/p/primary.html", false),
          makeSnapshot("/p/secondary.md", false),
        ],
      },
    );
    expect(both?.path).toBe("/p/primary.html");

    const emptyPath = deriveTaskOutput(
      makeCall("w-c", "write_file", { path: "", file_path: "/p/fallback.md" }),
      makeResult("w-c", "write_file", "ok"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/p/fallback.md", false)] },
    );
    expect(emptyPath?.path).toBe("/p/fallback.md");
  });

  it("requires a snapshot that recorded the file as non-existent", () => {
    // Snapshot exists but the file already existed: a modification, not a creation.
    expect(
      deriveTaskOutput(
        makeCall("w-d", "write_file", { path: "/p/index.html" }),
        makeResult("w-d", "write_file", "ok"),
        { ...CONTEXT, newSnapshots: [makeSnapshot("/p/index.html", true)] },
      ),
    ).toBeNull();
    // No matching snapshot at all: no creation evidence.
    expect(
      deriveTaskOutput(
        makeCall("w-e", "write_file", { path: "/p/other.html" }),
        makeResult("w-e", "write_file", "ok"),
        { ...CONTEXT, newSnapshots: [makeSnapshot("/p/index.html", false)] },
      ),
    ).toBeNull();
  });

  it("rejects created files whose extension is not an artifact", () => {
    expect(
      deriveTaskOutput(
        makeCall("w-f", "write_file", { path: "/p/src/App.jsx" }),
        makeResult("w-f", "write_file", "ok"),
        { ...CONTEXT, newSnapshots: [makeSnapshot("/p/src/App.jsx", false)] },
      ),
    ).toBeNull();
  });

  it("derives a created-file output for a newly created artifact", () => {
    const output = deriveTaskOutput(
      makeCall("w-g", "write_file", { path: "/p/landing.html" }),
      makeResult("w-g", "write_file", "wrote 3 lines"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/p/landing.html", false)] },
    );
    expect(output).toEqual({
      id: "run-1:w-g",
      runId: "run-1",
      conversationId: "conv-1",
      kind: "created-file",
      type: "html",
      path: "/p/landing.html",
      mimeType: "text/html",
      sourceTool: "write_file",
      createdAt: 1_000,
    });
  });

  it("omits the mimeType key when the artifact extension misses the MIME table", () => {
    // "vega" and the exact "vl.json" basename are artifacts without MIME
    // entries, so the conditional spread leaves the key out entirely.
    const vega = deriveTaskOutput(
      makeCall("w-h", "write_file", { path: "/p/chart.vega" }),
      makeResult("w-h", "write_file", "ok"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/p/chart.vega", false)] },
    );
    expect(vega).toMatchObject({ kind: "created-file", type: "vega" });
    expect(vega && "mimeType" in vega).toBe(false);

    const vlJson = deriveTaskOutput(
      makeCall("w-h2", "write_file", { path: "/p/vl.json" }),
      makeResult("w-h2", "write_file", "ok"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/p/vl.json", false)] },
    );
    expect(vlJson && "mimeType" in vlJson).toBe(false);
  });

  it("resolves relative tool paths through unique snapshot suffix matching", () => {
    const output = deriveTaskOutput(
      makeCall("w-i", "write_file", { path: "reports/result.md" }),
      makeResult("w-i", "write_file", "ok"),
      { ...CONTEXT, newSnapshots: [makeSnapshot("/proj/reports/result.md", false)] },
    );
    expect(output).toMatchObject({
      kind: "created-file",
      path: "/proj/reports/result.md",
      type: "md",
      mimeType: "text/markdown",
    });
  });

  it("returns null for tool names that produce no outputs", () => {
    expect(
      deriveTaskOutput(
        makeCall("u-1", "read_file", { path: "/p/a.html" }),
        makeResult("u-1", "read_file", "ok"),
        { ...CONTEXT, newSnapshots: [makeSnapshot("/p/a.html", false)] },
      ),
    ).toBeNull();
  });
});

describe("deriveTaskOutputs", () => {
  it("maps results by call id and skips calls without a result", () => {
    const outputs = deriveTaskOutputs(
      [
        makeCall("a", "write_file", { path: "/p/a.html" }),
        makeCall("orphan", "write_file", { path: "/p/b.html" }),
      ],
      [makeResult("a", "write_file", "ok")],
      [makeSnapshot("/p/a.html", false), makeSnapshot("/p/b.html", false)],
      CONTEXT,
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ id: "run-1:a", path: "/p/a.html" });
  });

  it("deduplicates repeated outputs with the same id", () => {
    const outputs = deriveTaskOutputs(
      [
        makeCall("dup", "write_file", { path: "/p/x.html" }),
        makeCall("dup", "write_file", { path: "/p/x.html" }),
      ],
      [makeResult("dup", "write_file", "ok")],
      [makeSnapshot("/p/x.html", false)],
      CONTEXT,
    );
    expect(outputs).toHaveLength(1);
  });

  it("keeps only the first output for the same file within one run", () => {
    const outputs = deriveTaskOutputs(
      [
        makeCall("w", "write_file", { path: "/p/landing.html" }),
        makeCall("p", "apply_patch", { path: "/p/landing.html" }),
        makeCall("r", "report_output", { path: "/p/landing.html" }),
      ],
      [
        makeResult("w", "write_file", "ok", { completedAt: 1_000 }),
        makeResult("p", "apply_patch", "ok", { completedAt: 2_000 }),
        makeResult(
          "r",
          "report_output",
          JSON.stringify({ reported: true, path: "/p/landing.html", size: 10 }),
          { completedAt: 3_000 },
        ),
      ],
      [makeSnapshot("/p/landing.html", false)],
      CONTEXT,
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ id: "run-1:w", sourceTool: "write_file" });
  });

  it("does not path-deduplicate screenshots of the same path", () => {
    const payload = JSON.stringify({ path: "/shots/home.png" });
    const outputs = deriveTaskOutputs(
      [makeCall("s1", "browser_screenshot", {}), makeCall("s2", "browser_screenshot", {})],
      [
        makeResult("s1", "browser_screenshot", payload),
        makeResult("s2", "browser_screenshot", payload),
      ],
      [],
      CONTEXT,
    );
    expect(outputs.map((output) => output.id)).toEqual(["run-1:s1", "run-1:s2"]);
  });

  it("passes only non-existing snapshots as creation candidates to every call", () => {
    const outputs = deriveTaskOutputs(
      [
        makeCall("old", "write_file", { path: "index.html" }),
        makeCall("new", "write_file", { path: "notes.md" }),
      ],
      [makeResult("old", "write_file", "ok"), makeResult("new", "write_file", "ok")],
      [makeSnapshot("/proj/index.html", true), makeSnapshot("/proj/notes.md", false)],
      CONTEXT,
    );
    // The existed snapshot is filtered out, so the first write finds no
    // creation evidence; the second still resolves through the filtered set.
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ id: "run-1:new", path: "/proj/notes.md" });
  });

  it("yields nothing when a relative path matches multiple snapshots", () => {
    const outputs = deriveTaskOutputs(
      [makeCall("amb", "write_file", { path: "x/report.html" })],
      [makeResult("amb", "write_file", "ok")],
      [makeSnapshot("/a/x/report.html", false), makeSnapshot("/b/x/report.html", false)],
      CONTEXT,
    );
    expect(outputs).toHaveLength(0);
  });
});

describe("mergeTaskOutputs", () => {
  it("merges previous and current outputs sorted by createdAt", () => {
    const earlier = makeOutput("run-1:a", 1_000);
    const middle = makeOutput("run-1:c", 2_000);
    const later = makeOutput("run-1:b", 3_000);
    expect(mergeTaskOutputs([later], [earlier, middle])).toEqual([earlier, middle, later]);
  });

  it("keeps the previous output when ids collide", () => {
    const previous = makeOutput("run-1:a", 5_000, { path: "/p/previous.txt" });
    const current = makeOutput("run-1:a", 1_000, { path: "/p/current.txt" });
    const merged = mergeTaskOutputs([previous], [current]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.path).toBe("/p/previous.txt");
  });

  it("keeps same-path outputs from different runs", () => {
    const first = makeOutput("run-1:a", 1_000, { path: "/p/shared.txt" });
    const second = makeOutput("run-2:a", 2_000, { path: "/p/shared.txt" });
    expect(mergeTaskOutputs([first], [second])).toHaveLength(2);
  });
});
