import { z } from "zod";

/**
 * Evir Canvas document model (§72): a versioned, structured graph artifact
 * (`.evir-canvas`) — nodes/edges/viewport/metadata — written by agent tools
 * and edited by the user in the canvas view. All mutations flow through the
 * pure functions here so the agent-side layout rule stays testable:
 *
 *   Agent `update_node` without an explicit position PRESERVES the node's
 *   current position — user layout is never clobbered by content updates.
 */

export const CANVAS_EXTENSION = ".evir-canvas";
export const CANVAS_FORMAT = "evir-canvas";
export const CANVAS_SCHEMA_VERSION = 1;
export const CANVAS_MAX_NODES = 500;
export const CANVAS_MAX_EDGES = 1000;
export const CANVAS_MAX_OPS = 100;

export type CanvasNodeType = "note" | "task" | "resource" | "decision";
export type CanvasNodeStatus = "todo" | "doing" | "done";
export type CanvasUpdatedBy = "agent" | "user";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  detail?: string | undefined;
  status?: CanvasNodeStatus | undefined;
  position: CanvasPoint;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string | undefined;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasMetadata {
  createdAt: number;
  updatedAt: number;
  updatedBy: CanvasUpdatedBy;
}

export interface EvirCanvasDocument {
  format: typeof CANVAS_FORMAT;
  version: typeof CANVAS_SCHEMA_VERSION;
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport?: CanvasViewport | undefined;
  metadata: CanvasMetadata;
}

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict();

export const canvasNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(["note", "task", "resource", "decision"]),
    title: z.string().min(1).max(200),
    detail: z.string().max(4000).optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    position: pointSchema,
  })
  .strict();

export const canvasEdgeSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: z.string().min(1).max(64),
    target: z.string().min(1).max(64),
    label: z.string().max(120).optional(),
  })
  .strict();

export const canvasDocumentSchema = z
  .object({
    format: z.literal(CANVAS_FORMAT),
    version: z.literal(CANVAS_SCHEMA_VERSION),
    title: z.string().min(1).max(200),
    nodes: z.array(canvasNodeSchema).max(CANVAS_MAX_NODES),
    edges: z.array(canvasEdgeSchema).max(CANVAS_MAX_EDGES),
    viewport: z
      .object({ x: z.number(), y: z.number(), zoom: z.number().min(0.1).max(4) })
      .strict()
      .optional(),
    metadata: z
      .object({
        createdAt: z.number(),
        updatedAt: z.number(),
        updatedBy: z.enum(["agent", "user"]),
      })
      .strict(),
  })
  .strict();

export function parseCanvasDocument(raw: string): EvirCanvasDocument {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("canvas document is not valid JSON");
  }
  const result = canvasDocumentSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`canvas document invalid: ${result.error.issues[0]?.message ?? "schema"}`);
  }
  return result.data;
}

/** Parse-or-throw with a readable message instead of a ZodError dump. */
function parseDocumentStrict(value: unknown): EvirCanvasDocument {
  const result = canvasDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "canvas document schema");
  }
  return result.data;
}

export function serializeCanvasDocument(document: EvirCanvasDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function createCanvasDocument(input: {
  title: string;
  nodes?: readonly CanvasNode[] | undefined;
  edges?: readonly CanvasEdge[] | undefined;
}): EvirCanvasDocument {
  const now = Date.now();
  const document: EvirCanvasDocument = parseDocumentStrict({
    format: CANVAS_FORMAT,
    version: CANVAS_SCHEMA_VERSION,
    title: input.title,
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    metadata: { createdAt: now, updatedAt: now, updatedBy: "agent" },
  });
  return document;
}

/** Agent-side operations accepted by `update_canvas` / applyCanvasOperations. */
export type CanvasOperation =
  | { op: "add_node"; node: CanvasNode }
  | {
      op: "update_node";
      id: string;
      title?: string | undefined;
      detail?: string | undefined;
      status?: CanvasNodeStatus | undefined;
      type?: CanvasNodeType | undefined;
      position?: CanvasPoint | undefined;
    }
  | { op: "remove_node"; id: string }
  | { op: "add_edge"; edge: CanvasEdge }
  | { op: "update_edge"; id: string; label?: string | undefined }
  | { op: "remove_edge"; id: string }
  | { op: "set_title"; title: string };

export interface CanvasApplyResult {
  document: EvirCanvasDocument;
  applied: number;
  skipped: { index: number; reason: string }[];
}

/**
 * Apply operations to a canvas document. The returned document is a new
 * object; `update_node` merges fields and keeps the existing position unless
 * the operation carries one (§76: agent updates must not clobber user
 * layout). Removing a node cascades to its edges.
 */
export function applyCanvasOperations(
  source: EvirCanvasDocument,
  operations: readonly CanvasOperation[],
  updatedBy: CanvasUpdatedBy = "agent",
): CanvasApplyResult {
  if (operations.length > CANVAS_MAX_OPS) {
    throw new Error(`too many operations (max ${CANVAS_MAX_OPS})`);
  }
  const nodes = new Map(source.nodes.map((node) => [node.id, { ...node }]));
  const edges = new Map(source.edges.map((edge) => [edge.id, { ...edge }]));
  const skipped: { index: number; reason: string }[] = [];
  let applied = 0;

  const apply = (index: number, run: () => string | null): void => {
    const reason = run();
    if (reason === null) applied += 1;
    else skipped.push({ index, reason });
  };

  operations.forEach((operation, index) => {
    switch (operation.op) {
      case "add_node":
        apply(index, () => {
          if (nodes.has(operation.node.id)) return `duplicate node id ${operation.node.id}`;
          if (nodes.size >= CANVAS_MAX_NODES) return `node limit reached (${CANVAS_MAX_NODES})`;
          canvasNodeSchema.parse(operation.node);
          nodes.set(operation.node.id, { ...operation.node });
          return null;
        });
        break;
      case "update_node":
        apply(index, () => {
          const existing = nodes.get(operation.id);
          if (!existing) return `unknown node ${operation.id}`;
          // Layout rule: no position in the operation → keep the user's layout.
          const { position, title, detail, status, type } = operation;
          const next: CanvasNode = {
            ...existing,
            ...(title !== undefined ? { title } : {}),
            ...(detail !== undefined ? { detail } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(type !== undefined ? { type } : {}),
            ...(position !== undefined ? { position } : {}),
          };
          canvasNodeSchema.parse(next);
          nodes.set(operation.id, next);
          return null;
        });
        break;
      case "remove_node":
        apply(index, () => {
          if (!nodes.delete(operation.id)) return `unknown node ${operation.id}`;
          for (const [edgeId, edge] of edges) {
            if (edge.source === operation.id || edge.target === operation.id) edges.delete(edgeId);
          }
          return null;
        });
        break;
      case "add_edge":
        apply(index, () => {
          if (edges.has(operation.edge.id)) return `duplicate edge id ${operation.edge.id}`;
          if (!nodes.has(operation.edge.source)) return `unknown source ${operation.edge.source}`;
          if (!nodes.has(operation.edge.target)) return `unknown target ${operation.edge.target}`;
          if (edges.size >= CANVAS_MAX_EDGES) return `edge limit reached (${CANVAS_MAX_EDGES})`;
          canvasEdgeSchema.parse(operation.edge);
          edges.set(operation.edge.id, { ...operation.edge });
          return null;
        });
        break;
      case "update_edge":
        apply(index, () => {
          const existing = edges.get(operation.id);
          if (!existing) return `unknown edge ${operation.id}`;
          const next = {
            ...existing,
            ...(operation.label !== undefined ? { label: operation.label } : {}),
          };
          canvasEdgeSchema.parse(next);
          edges.set(operation.id, next);
          return null;
        });
        break;
      case "remove_edge":
        apply(index, () => {
          if (!edges.delete(operation.id)) return `unknown edge ${operation.id}`;
          return null;
        });
        break;
      case "set_title":
        apply(index, () => {
          if (operation.title.trim().length === 0) return "title must not be empty";
          return null;
        });
        break;
    }
  });

  let lastTitle: string | null = null;
  for (const operation of operations) {
    if (operation.op === "set_title" && operation.title.trim().length > 0) {
      lastTitle = operation.title;
    }
  }
  const document: EvirCanvasDocument = {
    format: CANVAS_FORMAT,
    version: CANVAS_SCHEMA_VERSION,
    title: lastTitle !== null ? lastTitle : source.title,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    ...(source.viewport !== undefined ? { viewport: source.viewport } : {}),
    metadata: {
      createdAt: source.metadata.createdAt,
      updatedAt: Date.now(),
      updatedBy,
    },
  };
  return { document: parseDocumentStrict(document), applied, skipped };
}

/** User-edit path used by the canvas view's autosave (§76). */
export function userEditCanvasDocument(
  source: EvirCanvasDocument,
  edit: (draft: EvirCanvasDocument) => void,
): EvirCanvasDocument {
  const draft: EvirCanvasDocument = {
    ...source,
    nodes: source.nodes.map((node) => ({ ...node })),
    edges: source.edges.map((edge) => ({ ...edge })),
    metadata: { ...source.metadata },
  };
  edit(draft);
  draft.metadata = { ...draft.metadata, updatedAt: Date.now(), updatedBy: "user" };
  return parseDocumentStrict(draft);
}
