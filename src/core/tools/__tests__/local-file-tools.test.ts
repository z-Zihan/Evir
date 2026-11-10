// Systematic branch coverage for the local file tools beyond stage2-tools
// (web-mode unavailability, snapshot chain, report_output, risk levels).
// Every call goes through the public LOCAL_FILE_TOOLS entry point.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/tools/tool-executor", () => ({
  TOOL_NOT_AVAILABLE: "not_available_in_browser",
}));

import { LOCAL_FILE_TOOLS, PATH_BLOCKED } from "../builtin/local-file-tools";
import type { EvirRuntime } from "../../../runtime/types";

const tool = (id: string) => LOCAL_FILE_TOOLS.find((t) => t.id === id)!;

// Independent SHA-256 oracle for the [evir:file sha256=...] trailer.
const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const desktopRuntime = (
  storage: Record<string, unknown>,
  agentRun?: { id: string },
  overrides: { mode?: "agent" } = {},
) =>
  ({
    target: "desktop" as const,
    capabilities: new Set(["filesystem"]),
    has: () => true,
    getWorkspaceRoot: () => "/tmp/project",
    ...(agentRun ? { agentRun: { ...agentRun, snapshots: [], fileReferences: [] } } : {}),
    ...overrides,
    storage,
  }) as unknown as EvirRuntime;

describe("read_file", () => {
  it("returns content with a sha256 trailer", async () => {
    const runtime = desktopRuntime(
      { readFile: vi.fn(() => Promise.resolve("hello world")) },
      { id: "run-1" },
    );
    const result = await tool("read_file").execute({ path: "/tmp/project/a.txt" }, runtime);
    expect(result).toEqual({
      success: true,
      output: `hello world\n\n[evir:file sha256=${sha256Hex("hello world")}]`,
    });
  });

  it("truncates content over 10000 chars but hashes the full content", async () => {
    const content = "a".repeat(10_005);
    const runtime = desktopRuntime({
      readFile: vi.fn(() => Promise.resolve(content)),
    });
    const result = await tool("read_file").execute({ path: "/tmp/project/big.txt" }, runtime);
    expect(result.success).toBe(true);
    expect(result.output).toBe(
      `${"a".repeat(10_000)}\n... truncated\n\n[evir:file sha256=${sha256Hex(content)}]`,
    );
  });

  it("bounds and redacts storage failures to tool_error", async () => {
    const leaky = vi.fn(() => Promise.reject(new Error("failed with sk-abcdefghijkl12 key")));
    const result = await tool("read_file").execute(
      { path: "/tmp/project/a.txt" },
      desktopRuntime({ readFile: leaky }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool_error");
    expect(result.output).toBe("failed with [REDACTED] key");

    const long = vi.fn(() => Promise.reject(new Error("x".repeat(1_500))));
    const bounded = await tool("read_file").execute(
      { path: "/tmp/project/a.txt" },
      desktopRuntime({ readFile: long }),
    );
    expect(bounded.error).toBe("tool_error");
    expect(bounded.output).toBe("x".repeat(1_000));
  });
});

describe("argument schema validation", () => {
  it("read_file rejects a missing path with the first zod issue", async () => {
    const result = await tool("read_file").execute({}, desktopRuntime({}));
    expect(result).toEqual({
      success: false,
      output: "Invalid input: expected string, received undefined",
      error: "tool_error",
    });
  });

  it("read_file rejects an empty path", async () => {
    const result = await tool("read_file").execute({ path: "" }, desktopRuntime({}));
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool_error");
    expect(result.output).toBe("Too small: expected string to have >=1 characters");
  });

  it("write_file rejects a missing content field", async () => {
    const result = await tool("write_file").execute(
      { path: "/tmp/project/a.txt" },
      desktopRuntime({}),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool_error");
    expect(result.output).toBe("Invalid input: expected string, received undefined");
  });

  it("restore_snapshot rejects missing snapshot fields", async () => {
    const result = await tool("restore_snapshot").execute({}, desktopRuntime({}));
    expect(result.success).toBe(false);
    expect(result.error).toBe("tool_error");
    expect(result.output).toBe("Invalid input: expected string, received undefined");
  });
});

describe("path_blocked", () => {
  it("read_file blocks traversal and system prefixes", async () => {
    const readFile = vi.fn();
    const runtime = desktopRuntime({ readFile });
    for (const path of ["../outside.txt", "/etc/passwd"]) {
      const result = await tool("read_file").execute({ path }, runtime);
      expect(result).toEqual({ success: false, output: "Path not allowed", error: PATH_BLOCKED });
    }
    expect(readFile).not.toHaveBeenCalled();
  });

  it("run_command blocks a cwd outside the workspace", async () => {
    const runCommand = vi.fn();
    const result = await tool("run_command").execute(
      { cwd: "/etc", program: "ls", args: [] },
      desktopRuntime({ runCommand }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe(PATH_BLOCKED);
    expect(runCommand).not.toHaveBeenCalled();
  });
});

describe("list_directory", () => {
  it("suffixes directories with / and joins entries", async () => {
    const listDir = vi.fn(() =>
      Promise.resolve([
        { name: "src", path: "/tmp/project/src", is_dir: true, size: 0, modified: 1 },
        { name: "a.txt", path: "/tmp/project/a.txt", is_dir: false, size: 3, modified: 2 },
      ]),
    );
    const result = await tool("list_directory").execute(
      { path: "/tmp/project" },
      desktopRuntime({ listDir }, { id: "run-1" }),
    );
    expect(result).toEqual({ success: true, output: "src/\na.txt" });
    expect(listDir).toHaveBeenCalledWith("/tmp/project", { runId: "run-1" });
  });

  it("appends a truncation marker beyond 200 entries", async () => {
    const entries = Array.from({ length: 201 }, (_, i) => ({
      name: `f${i}`,
      path: `/tmp/project/f${i}`,
      is_dir: i % 50 === 0,
      size: 0,
      modified: null,
    }));
    const runtime = desktopRuntime({ listDir: vi.fn(() => Promise.resolve(entries)) });
    const result = await tool("list_directory").execute({ path: "/tmp/project" }, runtime);
    expect(result.success).toBe(true);
    const lines = result.output.split("\n");
    expect(lines).toHaveLength(201);
    expect(lines[0]).toBe("f0/");
    expect(lines[1]).toBe("f1");
    expect(lines.at(-1)).toBe("... truncated");
  });

  it("maps storage failures to tool_error", async () => {
    const runtime = desktopRuntime({
      listDir: vi.fn(() => Promise.reject(new Error("dir missing"))),
    });
    const result = await tool("list_directory").execute({ path: "/tmp/project" }, runtime);
    expect(result).toEqual({
      success: false,
      output: "dir missing",
      error: "tool_error",
    });
  });
});

describe("write_file", () => {
  it("reports UTF-8 byte count for multibyte content", async () => {
    const writeFile = vi.fn(() => Promise.resolve());
    const runtime = desktopRuntime({ writeFile });
    const result = await tool("write_file").execute(
      { path: "/tmp/project/greeting.txt", content: "你好，世界" },
      runtime,
    );
    // 5 CJK/comma chars → 15 UTF-8 bytes, not 5 characters.
    expect(result).toEqual({
      success: true,
      output: "wrote 15 bytes to /tmp/project/greeting.txt",
    });
    expect(writeFile).toHaveBeenCalledWith("/tmp/project/greeting.txt", "你好，世界");
  });

  it("marks an existing file reference stale after a write", async () => {
    const storage = {
      createSnapshot: vi.fn(() =>
        Promise.resolve({
          snapshot_id: "snap-1",
          file_path: "/tmp/project/file.txt",
          existed: true,
          original_hash: "old",
        }),
      ),
      sealSnapshot: vi.fn(() => Promise.resolve()),
      writeFile: vi.fn(() => Promise.resolve()),
    };
    const runtime = desktopRuntime(storage, { id: "run-1" }, { mode: "agent" });
    runtime.agentRun?.fileReferences.push({
      path: "/tmp/project/file.txt",
      contentHash: "old",
      lastReadAt: 1,
      summary: "Read 7 bytes",
      stale: false,
    });

    const result = await tool("write_file").execute(
      { path: "/tmp/project/file.txt", content: "changed" },
      runtime,
    );
    expect(result.success).toBe(true);
    expect(runtime.agentRun?.fileReferences).toHaveLength(1);
    expect(runtime.agentRun?.fileReferences[0]?.stale).toBe(true);
  });
});

describe("search_files", () => {
  it("joins results and forwards the pattern", async () => {
    const searchFiles = vi.fn(() =>
      Promise.resolve(["/tmp/project/src/util.ts", "/tmp/project/util.test.ts"]),
    );
    const result = await tool("search_files").execute(
      { path: "/tmp/project/src", pattern: "util" },
      desktopRuntime({ searchFiles }, { id: "run-2" }),
    );
    expect(result).toEqual({
      success: true,
      output: "/tmp/project/src/util.ts\n/tmp/project/util.test.ts",
    });
    expect(searchFiles).toHaveBeenCalledWith("/tmp/project/src", "util", { runId: "run-2" });
  });

  it("reports no matches for empty results", async () => {
    const runtime = desktopRuntime({ searchFiles: vi.fn(() => Promise.resolve([])) });
    const result = await tool("search_files").execute(
      { path: "/tmp/project", pattern: "zzz" },
      runtime,
    );
    expect(result).toEqual({ success: true, output: "no matches" });
  });
});

describe("search_docs", () => {
  it("searches only doc extensions (case-insensitive) with file:line hits", async () => {
    const candidates = [
      "/tmp/project/README.md",
      "/tmp/project/docs/guide.MDX",
      "/tmp/project/notes.txt",
      "/tmp/project/spec.rst",
      "/tmp/project/manual.adoc",
      "/tmp/project/app.ts",
      "/tmp/project/logo.png",
    ];
    const contents: Record<string, string> = {
      "/tmp/project/README.md": "# Title\nalpha feature here\nnothing\n  alpha indented  ",
      "/tmp/project/docs/guide.MDX": "ALPHA uppercase",
      "/tmp/project/notes.txt": "alpha plain",
      "/tmp/project/spec.rst": "alpha rst",
      "/tmp/project/manual.adoc": "alpha adoc",
    };
    const searchFiles = vi.fn(() => Promise.resolve(candidates));
    const readFile = vi.fn((path: string) => Promise.resolve(contents[path] ?? ""));
    const result = await tool("search_docs").execute(
      { path: "/tmp/project", pattern: "alpha" },
      desktopRuntime({ searchFiles, readFile }, { id: "run-3" }),
    );
    expect(result.success).toBe(true);
    expect(result.output.split("\n")).toEqual([
      "/tmp/project/README.md:2: alpha feature here",
      "/tmp/project/README.md:4: alpha indented",
      "/tmp/project/docs/guide.MDX:1: ALPHA uppercase",
      "/tmp/project/notes.txt:1: alpha plain",
      "/tmp/project/spec.rst:1: alpha rst",
      "/tmp/project/manual.adoc:1: alpha adoc",
    ]);
    // Doc search lists everything with an empty pattern, then filters locally.
    expect(searchFiles).toHaveBeenCalledWith("/tmp/project", "", { runId: "run-3" });
    // Non-doc candidates are never opened.
    const readPaths = readFile.mock.calls.map(([path]) => path);
    expect(readPaths).not.toContain("/tmp/project/app.ts");
    expect(readPaths).not.toContain("/tmp/project/logo.png");
  });

  it("caps hits at 80", async () => {
    const content = Array.from({ length: 100 }, (_, i) => `alpha line ${i}`).join("\n");
    const runtime = desktopRuntime({
      searchFiles: vi.fn(() => Promise.resolve(["/tmp/project/big.md"])),
      readFile: vi.fn(() => Promise.resolve(content)),
    });
    const result = await tool("search_docs").execute(
      { path: "/tmp/project", pattern: "alpha" },
      runtime,
    );
    const lines = result.output.split("\n");
    expect(lines).toHaveLength(80);
    expect(lines.at(-1)).toBe("/tmp/project/big.md:80: alpha line 79");
  });

  it("trims matched lines to 160 chars", async () => {
    const line = `alpha ${"y".repeat(200)}`;
    const runtime = desktopRuntime({
      searchFiles: vi.fn(() => Promise.resolve(["/tmp/project/long.txt"])),
      readFile: vi.fn(() => Promise.resolve(line)),
    });
    const result = await tool("search_docs").execute(
      { path: "/tmp/project", pattern: "alpha" },
      runtime,
    );
    expect(result.output).toBe(`/tmp/project/long.txt:1: alpha ${"y".repeat(154)}`);
    expect(result.output.endsWith("y".repeat(154))).toBe(true);
    expect(result.output.length).toBe("/tmp/project/long.txt:1: ".length + 160);
  });

  it("skips docs that fail to read", async () => {
    const readFile = vi.fn((path: string) =>
      path === "/tmp/project/broken.md"
        ? Promise.reject(new Error("unreadable"))
        : Promise.resolve("alpha works"),
    );
    const runtime = desktopRuntime({
      searchFiles: vi.fn(() => Promise.resolve(["/tmp/project/broken.md", "/tmp/project/ok.md"])),
      readFile,
    });
    const result = await tool("search_docs").execute(
      { path: "/tmp/project", pattern: "alpha" },
      runtime,
    );
    expect(result).toEqual({ success: true, output: "/tmp/project/ok.md:1: alpha works" });
  });

  it("reports no matches in project docs", async () => {
    const runtime = desktopRuntime({
      searchFiles: vi.fn(() => Promise.resolve(["/tmp/project/README.md"])),
      readFile: vi.fn(() => Promise.resolve("nothing relevant")),
    });
    const result = await tool("search_docs").execute(
      { path: "/tmp/project", pattern: "zzz" },
      runtime,
    );
    expect(result).toEqual({ success: true, output: "no matches in project docs" });
  });
});

describe("run_command", () => {
  it("formats exit code, stdout and stderr; carries exitCode", async () => {
    const runCommand = vi.fn(() =>
      Promise.resolve({ exit_code: 0, stdout: "ok out", stderr: "warn err", success: true }),
    );
    const result = await tool("run_command").execute(
      { cwd: "/tmp/project", program: "pnpm", args: ["test"] },
      desktopRuntime({ runCommand }),
    );
    expect(result).toEqual({
      success: true,
      output: "exit_code: 0\n--- stdout ---\nok out\n--- stderr ---\nwarn err",
      exitCode: 0,
    });
    expect(runCommand).toHaveBeenCalledWith("/tmp/project", "pnpm", ["test"], undefined);
  });

  it("omits exitCode when exit_code is null", async () => {
    const runCommand = vi.fn(() =>
      Promise.resolve({ exit_code: null, stdout: "", stderr: "boom", success: false }),
    );
    const result = await tool("run_command").execute(
      { cwd: "/tmp/project", program: "false", args: [] },
      desktopRuntime({ runCommand }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toBe("exit_code: N/A\n--- stdout ---\n\n--- stderr ---\nboom");
    expect("exitCode" in result).toBe(false);
  });

  it("maps a structured command_not_found error", async () => {
    const spawnError = Object.assign(new Error("spawn pnpm ENOENT"), {
      commandError: { kind: "command_not_found" },
    });
    const runCommand = vi.fn(() => Promise.reject(spawnError));
    const result = await tool("run_command").execute(
      { cwd: "/tmp/project", program: "pnpm", args: ["test"] },
      desktopRuntime({ runCommand }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("command_not_found");
    expect(result.output).toBe(
      "spawn pnpm ENOENT\nThe program is not on the resolved command PATH.",
    );
  });

  it("maps a legacy program-not-found message without commandError", async () => {
    const runCommand = vi.fn(() => Promise.reject(new Error("program not found: pnpm")));
    const result = await tool("run_command").execute(
      { cwd: "/tmp/project", program: "pnpm", args: ["test"] },
      desktopRuntime({ runCommand }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("command_not_found");
    expect(result.output).toContain("The program is not on the resolved command PATH.");
  });

  it("maps other failures to tool_error", async () => {
    const runCommand = vi.fn(() => Promise.reject(new Error("timed out after 30s")));
    const result = await tool("run_command").execute(
      { cwd: "/tmp/project", program: "sleep", args: ["100"] },
      desktopRuntime({ runCommand }),
    );
    expect(result).toEqual({
      success: false,
      output: "timed out after 30s",
      error: "tool_error",
    });
  });
});

describe("git_status", () => {
  it("reports non-repo directories", async () => {
    const gitStatus = vi.fn(() => Promise.resolve({ is_repo: false, entries: [], branch: null }));
    const result = await tool("git_status").execute(
      { path: "/tmp/project" },
      desktopRuntime({ gitStatus }),
    );
    expect(result).toEqual({ success: true, output: "Not a git repository" });
  });

  it("formats branch and status entries", async () => {
    const gitStatus = vi.fn(() =>
      Promise.resolve({
        is_repo: true,
        branch: "main",
        entries: [
          { status: "M", file: "src/a.ts" },
          { status: "??", file: "b.log" },
        ],
      }),
    );
    const result = await tool("git_status").execute(
      { path: "/tmp/project" },
      desktopRuntime({ gitStatus }),
    );
    expect(result).toEqual({
      success: true,
      output: "branch: main\nM\tsrc/a.ts\n??\tb.log",
    });
  });

  it("falls back to an unknown branch", async () => {
    const gitStatus = vi.fn(() => Promise.resolve({ is_repo: true, entries: [], branch: null }));
    const result = await tool("git_status").execute(
      { path: "/tmp/project" },
      desktopRuntime({ gitStatus }),
    );
    // Empty entries still leave the header newline in place.
    expect(result).toEqual({ success: true, output: "branch: unknown\n" });
  });
});

describe("git_diff", () => {
  it("forwards the staged flag and returns the diff", async () => {
    const gitDiff = vi.fn(() => Promise.resolve("diff --git a/x b/x"));
    const runtime = desktopRuntime({ gitDiff }, { id: "run-9" });
    const staged = await tool("git_diff").execute({ path: "/tmp/project", staged: true }, runtime);
    const unstaged = await tool("git_diff").execute({ path: "/tmp/project" }, runtime);
    expect(staged).toEqual({ success: true, output: "diff --git a/x b/x" });
    expect(unstaged).toEqual({ success: true, output: "diff --git a/x b/x" });
    expect(gitDiff).toHaveBeenNthCalledWith(1, "/tmp/project", true, { runId: "run-9" });
    expect(gitDiff).toHaveBeenNthCalledWith(2, "/tmp/project", false, { runId: "run-9" });
  });

  it("reports no changes for an empty diff", async () => {
    const runtime = desktopRuntime({ gitDiff: vi.fn(() => Promise.resolve("")) });
    const result = await tool("git_diff").execute({ path: "/tmp/project" }, runtime);
    expect(result).toEqual({ success: true, output: "no changes" });
  });
});

describe("filesystem utilities", () => {
  it("create_directory reports the created path", async () => {
    const createDirectory = vi.fn(() => Promise.resolve());
    const result = await tool("create_directory").execute(
      { path: "/tmp/project/logs" },
      desktopRuntime({ createDirectory }),
    );
    expect(result).toEqual({ success: true, output: "created directory: /tmp/project/logs" });
    expect(createDirectory).toHaveBeenCalledWith("/tmp/project/logs");
  });

  it("file_stat serializes metadata as pretty JSON", async () => {
    const stat = {
      name: "a.txt",
      path: "/tmp/project/a.txt",
      is_dir: false,
      is_file: true,
      is_symlink: false,
      size: 42,
      modified: 1_730_000_000_000,
      exists: true,
    };
    const runtime = desktopRuntime({
      fileStat: vi.fn(() => Promise.resolve(stat)),
    });
    const result = await tool("file_stat").execute({ path: "/tmp/project/a.txt" }, runtime);
    expect(result).toEqual({ success: true, output: JSON.stringify(stat, null, 2) });
  });

  it("create_snapshot reports the snapshot id", async () => {
    const createSnapshot = vi.fn(() =>
      Promise.resolve({
        snapshot_id: "snap-42",
        file_path: "/tmp/project/a.txt",
        existed: true,
        original_hash: "h0",
      }),
    );
    const result = await tool("create_snapshot").execute(
      { file_path: "/tmp/project/a.txt", run_id: "run-7" },
      desktopRuntime({ createSnapshot }),
    );
    expect(result).toEqual({ success: true, output: "snapshot created: snap-42" });
    expect(createSnapshot).toHaveBeenCalledWith("/tmp/project/a.txt", "run-7");
  });
});

describe("restore_snapshot", () => {
  it("reports success when restore returns true", async () => {
    const restoreSnapshot = vi.fn(() => Promise.resolve(true));
    const result = await tool("restore_snapshot").execute(
      { snapshot_id: "snap-1", run_id: "run-1", file_path: "/tmp/project/a.txt" },
      desktopRuntime({ restoreSnapshot }),
    );
    expect(result).toEqual({ success: true, output: "file restored from snapshot" });
    expect(restoreSnapshot).toHaveBeenCalledWith("snap-1", "run-1", "/tmp/project/a.txt");
  });

  it("reports failure when restore returns false", async () => {
    const restoreSnapshot = vi.fn(() => Promise.resolve(false));
    const result = await tool("restore_snapshot").execute(
      { snapshot_id: "snap-1", run_id: "run-1", file_path: "/tmp/project/a.txt" },
      desktopRuntime({ restoreSnapshot }),
    );
    expect(result).toEqual({ success: false, output: "restore failed" });
  });
});

describe("fileReferences tracking", () => {
  it("records a read with hash, byte summary and freshness", async () => {
    const runtime = desktopRuntime(
      { readFile: vi.fn(() => Promise.resolve("hello world")) },
      { id: "run-1" },
    );
    await tool("read_file").execute({ path: "/tmp/project/a.txt" }, runtime);
    const references = runtime.agentRun?.fileReferences ?? [];
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      path: "/tmp/project/a.txt",
      contentHash: sha256Hex("hello world"),
      summary: "Read 11 bytes",
      stale: false,
    });
    expect(typeof references[0]?.lastReadAt).toBe("number");
  });

  it("replaces the reference on re-read instead of accumulating", async () => {
    const readFile = vi
      .fn()
      .mockResolvedValueOnce("hello world")
      .mockResolvedValueOnce("hello again!");
    const runtime = desktopRuntime({ readFile }, { id: "run-1" });
    await tool("read_file").execute({ path: "/tmp/project/a.txt" }, runtime);
    await tool("read_file").execute({ path: "/tmp/project/a.txt" }, runtime);
    const references = runtime.agentRun?.fileReferences ?? [];
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      path: "/tmp/project/a.txt",
      contentHash: sha256Hex("hello again!"),
      summary: "Read 12 bytes",
      stale: false,
    });
  });
});
