import { z } from "zod";
import type { ToolCallContext, ToolDefinition, ToolResult } from "../../providers/tool-registry";
import type { EvirRuntime } from "../../../runtime/types";
import { redactLogValue } from "../../logging/redaction";
import { logger } from "../../logging/logger";
import { TOOL_NOT_AVAILABLE } from "../tool-executor";
import { validateWorkspacePath } from "./local-file-tools";
import {
  applyCanvasOperations,
  CANVAS_EXTENSION,
  createCanvasDocument,
  parseCanvasDocument,
  serializeCanvasDocument,
} from "../../../features/canvas/canvas-document";

/**
 * Canvas agent tools (§74): create and update `.evir-canvas` documents —
 * structured node/edge artifacts the user opens in the canvas view. Tools
 * write through the same storage port and workspace path validation as the
 * file tools; update merges preserve the user's layout (positions are only
 * moved when the operation says so).
 */

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict();
const nodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(["note", "task", "resource", "decision"]),
    title: z.string().min(1).max(200),
    detail: z.string().max(4000).optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    position: pointSchema,
  })
  .strict();
const edgeSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: z.string().min(1).max(64),
    target: z.string().min(1).max(64),
    label: z.string().max(120).optional(),
  })
  .strict();

const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: nodeSchema }).strict(),
  z
    .object({
      op: z.literal("update_node"),
      id: z.string().min(1).max(64),
      title: z.string().min(1).max(200).optional(),
      detail: z.string().max(4000).optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      type: z.enum(["note", "task", "resource", "decision"]).optional(),
      position: pointSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove_node"), id: z.string().min(1).max(64) }).strict(),
  z.object({ op: z.literal("add_edge"), edge: edgeSchema }).strict(),
  z
    .object({
      op: z.literal("update_edge"),
      id: z.string().min(1).max(64),
      label: z.string().max(120).optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove_edge"), id: z.string().min(1).max(64) }).strict(),
  z.object({ op: z.literal("set_title"), title: z.string().min(1).max(200) }).strict(),
]);

const createArgs = z
  .object({
    path: z.string().min(1).max(512),
    title: z.string().min(1).max(200),
    nodes: z.array(nodeSchema).max(500).optional(),
    edges: z.array(edgeSchema).max(1000).optional(),
  })
  .strict();

const updateArgs = z
  .object({
    path: z.string().min(1).max(512),
    ops: z.array(operationSchema).min(1).max(100),
  })
  .strict();

function unavailable(): ToolResult {
  return {
    success: false,
    output: "This tool requires the Evir desktop browser runtime.",
    error: TOOL_NOT_AVAILABLE,
  };
}

function toolError(error: unknown): ToolResult {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Canvas operation failed";
  const redacted = redactLogValue(rawMessage);
  logger.warn("agent", "canvas.tool-failed", {
    message: typeof redacted === "string" ? redacted.slice(0, 300) : "redacted",
  });
  return {
    success: false,
    output: typeof redacted === "string" ? redacted.slice(0, 500) : "Canvas operation failed",
    error: "canvas_error",
  };
}

function invalidArgs(error: z.ZodError): ToolResult {
  return {
    success: false,
    output: `Invalid arguments: ${error.issues[0]?.message ?? "schema"}`,
    error: "invalid_args",
  };
}

function withCanvasExtension(path: string): string {
  return path.toLowerCase().endsWith(CANVAS_EXTENSION) ? path : `${path}${CANVAS_EXTENSION}`;
}

async function createCanvas(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = createArgs.safeParse(args);
  if (!parsed.success) return invalidArgs(parsed.error);
  const safePath = validateWorkspacePath(withCanvasExtension(parsed.data.path), runtime);
  if (!safePath) {
    return { success: false, output: "path outside workspace", error: "path_blocked" };
  }
  try {
    const document = createCanvasDocument({
      title: parsed.data.title,
      ...(parsed.data.nodes !== undefined ? { nodes: parsed.data.nodes } : {}),
      ...(parsed.data.edges !== undefined ? { edges: parsed.data.edges } : {}),
    });
    await runtime.storage.writeFile(safePath, serializeCanvasDocument(document));
    return {
      success: true,
      output: JSON.stringify(
        {
          created: true,
          path: safePath,
          title: document.title,
          nodes: document.nodes.length,
          edges: document.edges.length,
        },
        null,
        2,
      ),
    };
  } catch (error) {
    return toolError(error);
  }
}

async function updateCanvas(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
  _signal?: AbortSignal,
  call?: ToolCallContext,
): Promise<ToolResult> {
  if (runtime.target !== "desktop" || !runtime.storage) return unavailable();
  const parsed = updateArgs.safeParse(args);
  if (!parsed.success) return invalidArgs(parsed.error);
  const safePath = validateWorkspacePath(parsed.data.path, runtime);
  if (!safePath) {
    return { success: false, output: "path outside workspace", error: "path_blocked" };
  }
  const correlation = { runId: runtime.agentRun?.id ?? null, ...(call ?? {}) };
  try {
    const raw = await runtime.storage.readFile(safePath, correlation);
    let document;
    try {
      document = parseCanvasDocument(raw);
    } catch (error) {
      return {
        success: false,
        output: `not an Evir canvas document: ${error instanceof Error ? error.message : "invalid"}`,
        error: "canvas_invalid_document",
      };
    }
    const { document: next, applied, skipped } = applyCanvasOperations(document, parsed.data.ops);
    await runtime.storage.writeFile(safePath, serializeCanvasDocument(next));
    return {
      success: true,
      output: JSON.stringify(
        {
          updated: true,
          path: safePath,
          title: next.title,
          applied,
          skipped: skipped.length,
          nodes: next.nodes.length,
          edges: next.edges.length,
        },
        null,
        2,
      ),
    };
  } catch (error) {
    return toolError(error);
  }
}

const nodeJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique node id (stable across updates)" },
    type: { type: "string", enum: ["note", "task", "resource", "decision"] },
    title: { type: "string", description: "Short node label" },
    detail: { type: "string", description: "Optional longer body text" },
    status: { type: "string", enum: ["todo", "doing", "done"], description: "task progress" },
    position: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  required: ["id", "type", "title", "position"],
} as const;

const edgeJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    source: { type: "string", description: "Source node id" },
    target: { type: "string", description: "Target node id" },
    label: { type: "string", description: "Optional edge label" },
  },
  required: ["id", "source", "target"],
} as const;

export const CANVAS_TOOLS: readonly ToolDefinition[] = [
  {
    id: "create_canvas",
    name: "create_canvas",
    description:
      "Create an Evir canvas document (.evir-canvas) — a structured node/edge board (types: note/task/resource/decision) the user can open and edit in the canvas view. Provide an initial node set with positions spread across the canvas.",
    source: "evir-local",
    riskLevel: "L2",
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path inside the workspace; .evir-canvas is appended when missing",
        },
        title: { type: "string", description: "Canvas title" },
        nodes: { type: "array", items: nodeJsonSchema },
        edges: { type: "array", items: edgeJsonSchema },
      },
      required: ["path", "title"],
      additionalProperties: false,
    },
    execute: createCanvas,
  },
  {
    id: "update_canvas",
    name: "update_canvas",
    description:
      "Update an existing .evir-canvas document with ordered operations (add/update/remove nodes and edges, set_title). Updating a node without a position keeps the user's current layout — only pass position when moving the node is intended.",
    source: "evir-local",
    riskLevel: "L2",
    requiredCapability: "filesystem",
    schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the .evir-canvas document inside the workspace",
        },
        ops: {
          type: "array",
          maxItems: 100,
          description: "Ordered operations",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: [
                  "add_node",
                  "update_node",
                  "remove_node",
                  "add_edge",
                  "update_edge",
                  "remove_edge",
                  "set_title",
                ],
              },
            },
            required: ["op"],
          },
        },
      },
      required: ["path", "ops"],
      additionalProperties: false,
    },
    execute: updateCanvas,
  },
];
