import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallRecord, ToolResultRecord } from "../../storage/db";
import { CANVAS_TOOLS } from "../builtin/canvas-tools";
import { deriveTaskOutput } from "../../../features/workspace/task-output-model";
import type { SnapshotResult } from "../../../runtime/desktop-storage-adapter";
import type { EvirRuntime } from "../../../runtime/types";

const FILES = new Map<string, string>();

function runtimeFixture(root = "/tmp/project"): EvirRuntime {
  return {
    target: "desktop",
    getWorkspaceRoot: () => root,
    storage: {
      readFile: (path: string) => {
        if (!FILES.has(path)) throw new Error("file not found");
        return Promise.resolve(FILES.get(path) ?? "");
      },
      writeFile: (path: string, content: string) => {
        FILES.set(path, content);
        return Promise.resolve();
      },
    },
    // Narrow fixture: the tools under test only touch the fields above.
  } as unknown as EvirRuntime;
}

function call(toolId: string, args: Record<string, unknown>) {
  const tool = CANVAS_TOOLS.find(({ id }) => id === toolId);
  if (!tool) throw new Error(`unknown tool ${toolId}`);
  return tool.execute(args, runtimeFixture());
}

const emptySnapshots: SnapshotResult[] = [];

function derive(toolName: string, args: Record<string, unknown>, output: string) {
  const runId = "run-1";
  const call: ToolCallRecord = {
    id: "call-1",
    messageId: "m1",
    conversationId: "c1",
    toolName,
    arguments: args,
    createdAt: Date.now(),
  };
  const result: ToolResultRecord = {
    id: "r1",
    toolCallId: "call-1",
    success: true,
    output,
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
  return deriveTaskOutput(call, result, {
    runId,
    conversationId: "c1",
    newSnapshots: emptySnapshots,
  });
}

describe("canvas agent tools", () => {
  beforeEach(() => {
    FILES.clear();
  });

  it("registers create_canvas and update_canvas as L2 filesystem tools", () => {
    expect(CANVAS_TOOLS.map((tool) => tool.id)).toEqual(["create_canvas", "update_canvas"]);
    for (const tool of CANVAS_TOOLS) {
      expect(tool.riskLevel).toBe("L2");
      expect(tool.requiredCapability).toBe("filesystem");
    }
  });

  it("create_canvas writes a valid document and reports evidence", async () => {
    const result = await call("create_canvas", {
      path: "plans/launch",
      title: "发布计划",
      nodes: [
        { id: "a", type: "task", title: "写文档", position: { x: 0, y: 0 } },
        { id: "b", type: "note", title: "审核", position: { x: 300, y: 20 } },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as { path: string; nodes: number };
    expect(payload.path).toBe("/tmp/project/plans/launch.evir-canvas");
    expect(payload.nodes).toBe(2);
    const written = JSON.parse(FILES.get("/tmp/project/plans/launch.evir-canvas") ?? "{}") as {
      format: string;
      metadata: { updatedBy: string };
    };
    expect(written.format).toBe("evir-canvas");
    expect(written.metadata.updatedBy).toBe("agent");
  });

  it("create_canvas rejects paths outside the workspace", async () => {
    const result = await call("create_canvas", { path: "../escape", title: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("path_blocked");
  });

  it("update_canvas applies ops and preserves user positions", async () => {
    await call("create_canvas", { path: "board.evir-canvas", title: "看板" });
    const result = await call("update_canvas", {
      path: "board.evir-canvas",
      ops: [
        {
          op: "add_node",
          node: { id: "n1", type: "task", title: "新任务", position: { x: 10, y: 10 } },
        },
        { op: "update_node", id: "n1", title: "改名", status: "doing" },
        { op: "set_title", title: "看板 v2" },
      ],
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as { applied: number; title: string };
    expect(payload.applied).toBe(3);
    expect(payload.title).toBe("看板 v2");
    const written = JSON.parse(FILES.get("/tmp/project/board.evir-canvas") ?? "{}") as {
      nodes: { id: string; title: string; status?: string; position: { x: number; y: number } }[];
    };
    const node = written.nodes.find((candidate) => candidate.id === "n1");
    expect(node.title).toBe("改名");
    expect(node.status).toBe("doing");
    expect(node.position).toEqual({ x: 10, y: 10 });
  });

  it("update_canvas refuses non-canvas files with a typed error", async () => {
    FILES.set("/tmp/project/plain.json", '{"hello": 1}');
    const result = await call("update_canvas", {
      path: "plain.json",
      ops: [{ op: "set_title", title: "x" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("canvas_invalid_document");
  });

  it("update_canvas reports skipped ops without failing the write", async () => {
    await call("create_canvas", { path: "b.evir-canvas", title: "B" });
    const result = await call("update_canvas", {
      path: "b.evir-canvas",
      ops: [
        { op: "remove_node", id: "ghost" },
        { op: "add_node", node: { id: "x", type: "note", title: "X", position: { x: 0, y: 0 } } },
      ],
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output) as { applied: number; skipped: number };
    expect(payload.applied).toBe(1);
    expect(payload.skipped).toBe(1);
  });

  it("derives first-class canvas outputs from both tools (§73)", () => {
    const payload = JSON.stringify({ path: "/tmp/project/board.evir-canvas", title: "看板" });
    for (const toolName of ["create_canvas", "update_canvas"]) {
      const output = derive(toolName, { path: "board.evir-canvas" }, payload);
      expect(output).not.toBeNull();
      expect(output?.kind).toBe("canvas");
      expect(output?.type).toBe("canvas");
      expect(output?.path).toBe("/tmp/project/board.evir-canvas");
    }
    // Malformed payloads never become outputs.
    expect(derive("create_canvas", {}, "not json")).toBeNull();
  });
});

vi.mock("../tool-executor", () => ({ TOOL_NOT_AVAILABLE: "tool_not_available" }));
