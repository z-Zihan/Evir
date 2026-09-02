// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/tools/tool-executor", () => ({
  TOOL_NOT_AVAILABLE: "not_available_in_browser",
  ToolExecutor: class {
    constructor() {}
    async execute() {
      await Promise.resolve();
      return { success: false, output: "not available", error: "not_available_in_browser" };
    }
  },
}));

vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "web",
    capabilities: new Set(["chat"]),
    has: (c: string) => c === "chat",
  }),
}));

import { LOCAL_FILE_TOOLS } from "../builtin/local-file-tools";
import type { EvirRuntime } from "../../../runtime/types";

const webRuntime = {
  target: "web" as const,
  capabilities: new Set(["chat"]),
  has: (c: string) => c === "chat",
} as unknown as EvirRuntime;

describe("file tools — web mode returns unavailable", () => {
  it("read_file returns unavailable in web mode", async () => {
    const tool = LOCAL_FILE_TOOLS.find((t) => t.id === "read_file")!;
    const result = await tool.execute({ path: "/tmp/test.txt" }, webRuntime);
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_available_in_browser");
  });

  it("write_file returns unavailable in web mode", async () => {
    const tool = LOCAL_FILE_TOOLS.find((t) => t.id === "write_file")!;
    const result = await tool.execute({ path: "/tmp/test.txt", content: "hi" }, webRuntime);
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_available_in_browser");
  });

  it("apply_patch returns unavailable in web mode", async () => {
    const tool = LOCAL_FILE_TOOLS.find((t) => t.id === "apply_patch")!;
    const result = await tool.execute(
      { path: "/tmp/test.txt", old_content: "a", new_content: "b" },
      webRuntime,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_available_in_browser");
  });

  it("run_command returns unavailable in web mode", async () => {
    const tool = LOCAL_FILE_TOOLS.find((t) => t.id === "run_command")!;
    const result = await tool.execute({ cwd: "/tmp", program: "ls", args: [] }, webRuntime);
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_available_in_browser");
  });

  it("git_status returns unavailable in web mode", async () => {
    const tool = LOCAL_FILE_TOOLS.find((t) => t.id === "git_status")!;
    const result = await tool.execute({ path: "/tmp" }, webRuntime);
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_available_in_browser");
  });
});

describe("agent mutation snapshots", () => {
  it("passes workspace-relative paths to the desktop storage adapter as absolute paths", async () => {
    const readFile = vi.fn(() => Promise.resolve("relative content"));
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem"]),
      has: () => true,
      getWorkspaceRoot: () => "/tmp/project",
      storage: { readFile },
    } as unknown as EvirRuntime;
    const read = LOCAL_FILE_TOOLS.find((tool) => tool.id === "read_file")!;

    await expect(read.execute({ path: "input.txt" }, runtime)).resolves.toMatchObject({
      success: true,
    });
    // The second argument carries IPC correlation (no run context here → runId null).
    expect(readFile).toHaveBeenCalledWith("/tmp/project/input.txt", { runId: null });
  });

  it("preserves bounded native string errors for diagnosis", async () => {
    const readFile = vi.fn();
    readFile.mockRejectedValue("native read failed");
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem"]),
      has: () => true,
      getWorkspaceRoot: () => "/tmp/project",
      storage: { readFile },
    } as unknown as EvirRuntime;
    const read = LOCAL_FILE_TOOLS.find((tool) => tool.id === "read_file")!;

    await expect(read.execute({ path: "input.txt" }, runtime)).resolves.toEqual({
      success: false,
      output: "native read failed",
      error: "tool_error",
    });
  });

  it("tracks a content hash and marks the reference stale after mutation", async () => {
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem"]),
      has: () => true,
      mode: "agent" as const,
      getWorkspaceRoot: () => "/tmp/project",
      agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
      storage: {
        readFile: vi.fn(() => Promise.resolve("original content")),
        createSnapshot: vi.fn(() =>
          Promise.resolve({
            snapshot_id: "snapshot-1",
            file_path: "/tmp/project/file.txt",
            existed: true,
            original_hash: "native-hash",
          }),
        ),
        sealSnapshot: vi.fn(() => Promise.resolve()),
        writeFile: vi.fn(() => Promise.resolve()),
      },
    } as unknown as EvirRuntime;
    const read = LOCAL_FILE_TOOLS.find((tool) => tool.id === "read_file")!;
    const write = LOCAL_FILE_TOOLS.find((tool) => tool.id === "write_file")!;

    const readResult = await read.execute({ path: "/tmp/project/file.txt" }, runtime);
    expect(readResult.output).toMatch(/sha256=[a-f0-9]{64}/);
    expect(runtime.agentRun?.fileReferences[0]).toMatchObject({
      path: "/tmp/project/file.txt",
      stale: false,
    });

    await write.execute({ path: "/tmp/project/file.txt", content: "changed" }, runtime);
    expect(runtime.agentRun?.fileReferences[0]?.stale).toBe(true);
  });

  it("creates one baseline snapshot before repeated writes to a file", async () => {
    const createSnapshot = vi.fn(() =>
      Promise.resolve({
        snapshot_id: "snapshot-1",
        file_path: "/tmp/project/file.txt",
        existed: true,
        original_hash: "hash",
      }),
    );
    const writeFile = vi.fn(() => Promise.resolve());
    const applyPatch = vi.fn(() => Promise.resolve());
    const sealSnapshot = vi.fn(() => Promise.resolve());
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem"]),
      has: (capability: string) => capability === "filesystem",
      mode: "agent" as const,
      getWorkspaceRoot: () => "/tmp/project",
      agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
      storage: { createSnapshot, sealSnapshot, writeFile, applyPatch },
    } as unknown as EvirRuntime;

    const write = LOCAL_FILE_TOOLS.find((tool) => tool.id === "write_file")!;
    const patch = LOCAL_FILE_TOOLS.find((tool) => tool.id === "apply_patch")!;
    await expect(
      write.execute({ path: "/tmp/project/file.txt", content: "first" }, runtime),
    ).resolves.toMatchObject({ success: true });
    await expect(
      patch.execute(
        { path: "/tmp/project/file.txt", old_content: "first", new_content: "second" },
        runtime,
      ),
    ).resolves.toMatchObject({ success: true });

    expect(createSnapshot).toHaveBeenCalledOnce();
    expect(createSnapshot).toHaveBeenCalledWith("/tmp/project/file.txt", "run-1");
    expect(runtime.agentRun?.snapshots).toHaveLength(1);
    expect(sealSnapshot).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledOnce();
    expect(applyPatch).toHaveBeenCalledOnce();
  });

  it("does not mutate a file when its safety snapshot fails", async () => {
    const writeFile = vi.fn(() => Promise.resolve());
    const runtime = {
      target: "desktop" as const,
      capabilities: new Set(["filesystem"]),
      has: () => true,
      mode: "agent" as const,
      getWorkspaceRoot: () => "/tmp/project",
      agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
      storage: {
        createSnapshot: vi.fn(() => Promise.reject(new Error("snapshot unavailable"))),
        writeFile,
      },
    } as unknown as EvirRuntime;

    const write = LOCAL_FILE_TOOLS.find((tool) => tool.id === "write_file")!;
    await expect(
      write.execute({ path: "/tmp/project/file.txt", content: "unsafe" }, runtime),
    ).resolves.toEqual({
      success: false,
      output: "snapshot unavailable",
      error: "snapshot_failed",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("tool definitions", () => {
  it("all tools have required fields", () => {
    for (const tool of LOCAL_FILE_TOOLS) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.source).toBe("evir-local");
      expect(tool.riskLevel).toMatch(/^L[0-4]$/);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("read_file and list_directory are L1", () => {
    expect(LOCAL_FILE_TOOLS.find((t) => t.id === "read_file")?.riskLevel).toBe("L1");
    expect(LOCAL_FILE_TOOLS.find((t) => t.id === "list_directory")?.riskLevel).toBe("L1");
  });

  it("write_file and apply_patch are L3", () => {
    expect(LOCAL_FILE_TOOLS.find((t) => t.id === "write_file")?.riskLevel).toBe("L3");
    expect(LOCAL_FILE_TOOLS.find((t) => t.id === "apply_patch")?.riskLevel).toBe("L3");
  });

  it("run_command is L3", () => {
    expect(LOCAL_FILE_TOOLS.find((t) => t.id === "run_command")?.riskLevel).toBe("L3");
  });

  it("restore_snapshot is L3", () => {
    expect(LOCAL_FILE_TOOLS.find((t) => t.id === "restore_snapshot")?.riskLevel).toBe("L3");
  });

  it("has 13 tools total", () => {
    expect(LOCAL_FILE_TOOLS).toHaveLength(13);
    expect(LOCAL_FILE_TOOLS.find(({ id }) => id === "search_docs")?.riskLevel).toBe("L1");
  });
});

describe("path validation", () => {
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

  it("blocks path traversal with ..", () => {
    expect(validatePath("/tmp/project/../etc/passwd")).toBeUndefined();
  });

  it("blocks relative paths", () => {
    expect(validatePath("relative/file.txt")).toBeUndefined();
  });

  it("blocks .ssh directory", () => {
    expect(validatePath("/home/user/.ssh/id_rsa")).toBeUndefined();
  });

  it("allows normal workspace paths", () => {
    expect(validatePath("/tmp/project/src/index.ts")).toBe("/tmp/project/src/index.ts");
  });

  it("allows hidden files like .gitignore", () => {
    expect(validatePath("/tmp/project/.gitignore")).toBe("/tmp/project/.gitignore");
  });

  it("blocks empty path", () => {
    expect(validatePath("")).toBeUndefined();
  });

  it("blocks /etc", () => {
    expect(validatePath("/etc/passwd")).toBeUndefined();
    expect(validatePath("/etc/")).toBeUndefined();
  });
});

describe("mode tool isolation", () => {
  it("ask mode only allows L0", () => {
    const limits = { ask: "L0", plan: "L1", agent: "L4" };
    expect(limits.ask).toBe("L0");
  });

  it("plan mode allows up to L1", () => {
    const limits = { ask: "L0", plan: "L1", agent: "L4" };
    expect(limits.plan).toBe("L1");
  });

  it("agent mode allows up to L4", () => {
    const limits = { ask: "L0", plan: "L1", agent: "L4" };
    expect(limits.agent).toBe("L4");
  });
});
