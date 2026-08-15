import { z } from "zod";
import type { McpTool } from "./types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 60_000;
export const MAX_MCP_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_MCP_TOOL_COUNT = 2_000;
export const MAX_MCP_DISCOVERY_PAGES = 100;
export const MAX_MCP_SCHEMA_BYTES = 256 * 1024;

const JsonRpcIdSchema = z.union([z.string(), z.number()]);
const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

const JsonRpcResponseSchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: JsonRpcIdSchema, result: z.unknown() }),
  z.object({ jsonrpc: z.literal("2.0"), id: JsonRpcIdSchema, error: JsonRpcErrorSchema }),
]);

export const McpNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const JsonSchemaObject = z.record(z.string(), z.unknown());
const McpToolSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(20_000).optional(),
  inputSchema: JsonSchemaObject,
  outputSchema: JsonSchemaObject.optional(),
});

const InitializeResultSchema = z.object({
  protocolVersion: z.string().min(1),
  capabilities: z.record(z.string(), z.unknown()),
  serverInfo: z.object({ name: z.string().min(1), version: z.string().optional() }).passthrough(),
  instructions: z.string().max(100_000).optional(),
});

const ListToolsResultSchema = z.object({
  tools: z.array(McpToolSchema).max(MAX_MCP_TOOL_COUNT),
  nextCursor: z.string().min(1).max(2_048).optional(),
});

const ContentBlockSchema = z.object({ type: z.string().min(1) }).passthrough();
const ToolResultSchema = z
  .object({
    content: z.array(ContentBlockSchema).max(10_000),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
  })
  .passthrough();

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version?: string | undefined; [key: string]: unknown };
  instructions?: string | undefined;
}

export interface McpListToolsResult {
  tools: McpTool[];
  nextCursor?: string | undefined;
}

export interface McpCallToolResult {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean | undefined;
  structuredContent?: object | string | number | boolean | null;
}

export class McpProtocolError extends Error {
  readonly code: number | undefined;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "McpProtocolError";
    this.code = code;
  }
}

export function unwrapJsonRpcResponse(value: unknown, expectedId: number): unknown {
  const parsed = JsonRpcResponseSchema.safeParse(value);
  if (!parsed.success) throw new McpProtocolError("Invalid JSON-RPC response from MCP server");
  if (parsed.data.id !== expectedId) throw new McpProtocolError("MCP response id mismatch");
  if ("error" in parsed.data) {
    throw new McpProtocolError(parsed.data.error.message, parsed.data.error.code);
  }
  return parsed.data.result;
}

export function parseInitializeResult(value: unknown): McpInitializeResult {
  const parsed = InitializeResultSchema.safeParse(value);
  if (!parsed.success) throw new McpProtocolError("Invalid MCP initialize result");
  return parsed.data;
}

export function parseListToolsResult(value: unknown): McpListToolsResult {
  const parsed = ListToolsResultSchema.safeParse(value);
  if (!parsed.success) throw new McpProtocolError("Invalid MCP tools/list result");
  return parsed.data;
}

export function parseCallToolResult(value: unknown): McpCallToolResult {
  const parsed = ToolResultSchema.safeParse(value);
  if (!parsed.success) throw new McpProtocolError("Invalid MCP tools/call result");
  return {
    content: parsed.data.content,
    ...(parsed.data.isError === undefined ? {} : { isError: parsed.data.isError }),
    ...(parsed.data.structuredContent === undefined
      ? {}
      : { structuredContent: parsed.data.structuredContent }),
  };
}

export function parseSseJsonRpc(
  text: string,
  expectedId: number,
  onNotification?: (method: string, params?: Record<string, unknown>) => void,
): unknown {
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const value: unknown = JSON.parse(data);
      const notification = McpNotificationSchema.safeParse(value);
      if (notification.success) {
        onNotification?.(notification.data.method, notification.data.params);
        continue;
      }
      return unwrapJsonRpcResponse(value, expectedId);
    } catch (error) {
      if (error instanceof McpProtocolError && error.message !== "MCP response id mismatch") {
        throw error;
      }
    }
  }
  throw new McpProtocolError("No matching JSON-RPC response in MCP event stream");
}
