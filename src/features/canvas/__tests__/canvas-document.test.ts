import { describe, expect, it } from "vitest";
import {
  applyCanvasOperations,
  CANVAS_MAX_NODES,
  CANVAS_MAX_OPS,
  createCanvasDocument,
  parseCanvasDocument,
  serializeCanvasDocument,
  userEditCanvasDocument,
  type CanvasNode,
  type EvirCanvasDocument,
} from "../canvas-document";

function docFixture(): EvirCanvasDocument {
  return createCanvasDocument({
    title: "发布计划",
    nodes: [
      { id: "a", type: "task", title: "写文档", status: "doing", position: { x: 0, y: 0 } },
      { id: "b", type: "note", title: "注意审核", position: { x: 260, y: 40 } },
    ],
    edges: [{ id: "e1", source: "a", target: "b" }],
  });
}

describe("canvas document model", () => {
  it("creates a versioned agent-authored document", () => {
    const doc = docFixture();
    expect(doc.format).toBe("evir-canvas");
    expect(doc.version).toBe(1);
    expect(doc.metadata.updatedBy).toBe("agent");
    expect(doc.nodes).toHaveLength(2);
  });

  it("round-trips through serialize/parse", () => {
    const doc = docFixture();
    const parsed = parseCanvasDocument(serializeCanvasDocument(doc));
    expect(parsed).toEqual(doc);
  });

  it("rejects foreign JSON, wrong format, and wrong version", () => {
    expect(() => parseCanvasDocument("not json")).toThrow(/not valid JSON/i);
    expect(() => parseCanvasDocument(JSON.stringify({ format: "tldraw", version: 99 }))).toThrow(
      /invalid/i,
    );
    expect(() => parseCanvasDocument(JSON.stringify({ ...docFixture(), version: 2 }))).toThrow(
      /invalid/i,
    );
  });

  it("agent update_node without position preserves the user layout (§76)", () => {
    const moved: CanvasNode = { ...docFixture().nodes[1]!, position: { x: 999, y: 999 } };
    const userMoved = userEditCanvasDocument(docFixture(), (draft) => {
      draft.nodes[1] = moved;
    });
    expect(userMoved.metadata.updatedBy).toBe("user");

    const { document } = applyCanvasOperations(userMoved, [
      { op: "update_node", id: "b", title: "注意审核（更新）" },
    ]);
    const nodeB = document.nodes.find((node) => node.id === "b");
    expect(nodeB?.title).toBe("注意审核（更新）");
    expect(nodeB?.position).toEqual({ x: 999, y: 999 });
    expect(document.metadata.updatedBy).toBe("agent");
  });

  it("agent update_node with position moves the node", () => {
    const { document } = applyCanvasOperations(docFixture(), [
      { op: "update_node", id: "a", position: { x: 42, y: 24 } },
    ]);
    expect(document.nodes.find((node) => node.id === "a")?.position).toEqual({ x: 42, y: 24 });
  });

  it("remove_node cascades to attached edges", () => {
    const { document, applied } = applyCanvasOperations(docFixture(), [
      { op: "remove_node", id: "a" },
    ]);
    expect(applied).toBe(1);
    expect(document.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(document.edges).toHaveLength(0);
  });

  it("reports skipped operations with reasons instead of failing the batch", () => {
    const { applied, skipped } = applyCanvasOperations(docFixture(), [
      { op: "add_node", node: { id: "a", type: "note", title: "重复", position: { x: 0, y: 0 } } },
      { op: "remove_edge", id: "missing" },
      { op: "add_edge", edge: { id: "e2", source: "a", target: "ghost" } },
      {
        op: "add_node",
        node: { id: "c", type: "decision", title: "上线?", position: { x: 500, y: 0 } },
      },
    ]);
    expect(applied).toBe(1);
    expect(skipped).toEqual([
      { index: 0, reason: "duplicate node id a" },
      { index: 1, reason: "unknown edge missing" },
      { index: 2, reason: "unknown target ghost" },
    ]);
  });

  it("set_title uses the last valid title", () => {
    const { document } = applyCanvasOperations(docFixture(), [
      { op: "set_title", title: "第一版" },
      { op: "set_title", title: "  " },
      { op: "set_title", title: "最终版" },
    ]);
    expect(document.title).toBe("最终版");
  });

  it("enforces node and operation caps", () => {
    const nodes: CanvasNode[] = Array.from({ length: CANVAS_MAX_NODES + 1 }, (_, index) => ({
      id: `n${index}`,
      type: "note" as const,
      title: `n${index}`,
      position: { x: 0, y: 0 },
    }));
    expect(() => createCanvasDocument({ title: "大画布", nodes })).toThrow(/<=500 items/i);
    const ops = Array.from({ length: CANVAS_MAX_OPS + 1 }, () => ({
      op: "set_title" as const,
      title: "x",
    }));
    expect(() => applyCanvasOperations(docFixture(), ops)).toThrow(/too many operations/i);
  });
});
