// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyCanvasOperations, createCanvasDocument } from "../canvas-document";
import { createCanvasHistory } from "../canvas-history";

/**
 * CAN-1: user edits stack into bounded undo/redo; agent rewrites land as
 * checkpoints; every snapshot is a whole validated document, so undo never
 * produces an illegal file.
 */

function seed(): ReturnType<typeof createCanvasDocument> {
  return createCanvasDocument({
    title: "Plan",
    nodes: [{ id: "n1", type: "task", title: "First", position: { x: 0, y: 0 } }],
  });
}

describe("canvas history (CAN-1)", () => {
  it("undoes and redoes a sequence of user edits", () => {
    const base = seed();
    const history = createCanvasHistory(base);

    const afterAdd = applyCanvasOperations(base, [
      {
        op: "add_node",
        node: { id: "n2", type: "note", title: "Second", position: { x: 100, y: 0 } },
      },
    ]).document;
    history.pushUserState(afterAdd);

    const afterRemove = applyCanvasOperations(afterAdd, [{ op: "remove_node", id: "n1" }]).document;
    history.pushUserState(afterRemove);

    expect(history.canUndo()).toBe(true);
    expect(history.undo()?.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(history.undo()?.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();

    expect(history.canRedo()).toBe(true);
    expect(history.redo()?.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(history.redo()?.nodes.map((node) => node.id)).toEqual(["n2"]);
    expect(history.canRedo()).toBe(false);
  });

  it("a new edit after undo trims the redo branch", () => {
    const base = seed();
    const history = createCanvasHistory(base);
    const afterEdit = applyCanvasOperations(base, [{ op: "set_title", title: "Renamed" }]).document;
    history.pushUserState(afterEdit);
    history.undo();

    const divergent = applyCanvasOperations(base, [
      {
        op: "add_node",
        node: { id: "n9", type: "note", title: "Other", position: { x: 5, y: 5 } },
      },
    ]).document;
    history.pushUserState(divergent);

    expect(history.canRedo()).toBe(false);
    // Undo steps back from the divergent edit to the pristine base.
    expect(history.undo()?.nodes.map((node) => node.id)).toEqual(["n1"]);
  });

  it("agent rewrites are checkpoints the user can undo back through safely", () => {
    const base = seed();
    const history = createCanvasHistory(base);
    const userMoved = applyCanvasOperations(
      base,
      [{ op: "update_node", id: "n1", position: { x: 42, y: 42 } }],
      "user",
    ).document;
    history.pushUserState(userMoved);

    const agentRewrite = applyCanvasOperations(userMoved, [
      {
        op: "add_node",
        node: { id: "a1", type: "resource", title: "From agent", position: { x: 9, y: 9 } },
      },
    ]).document;
    history.agentCheckpoint(agentRewrite);

    // Undo crosses the checkpoint back to the user state — still a whole,
    // schema-valid document with the agent node gone and layout preserved.
    const undone = history.undo();
    expect(undone?.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(undone?.nodes[0]?.position).toEqual({ x: 42, y: 42 });
    // And redo returns to the agent checkpoint.
    expect(history.redo()?.nodes.map((node) => node.id)).toEqual(["n1", "a1"]);
  });

  it("caps the stack at 50 states without losing the present", () => {
    const base = seed();
    const history = createCanvasHistory(base);
    for (let index = 0; index < 80; index += 1) {
      history.pushUserState(
        applyCanvasOperations(base, [{ op: "set_title", title: `T${index}` }]).document,
      );
    }
    let undos = 0;
    while (history.undo() !== null) undos += 1;
    expect(undos).toBe(50);
  });

  it("reset seeds a fresh history (initial load semantics)", () => {
    const history = createCanvasHistory(seed());
    history.pushUserState(seed());
    history.reset(seed());
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
