import type { ComponentActivationContext, ComponentDisposer } from "../components/types";
import type { ToolDefinition } from "../providers/tool-registry";
import type { McpClient } from "./mcp-client";
import type { McpServerConfig, McpTool } from "./types";

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOL_OUTPUT_LENGTH = 100_000;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function publicMcpToolId(serverId: string, rawName: string): string {
  const joined = `mcp__${serverId}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= MAX_TOOL_NAME_LENGTH) return normalized;
  const suffix = stableHash(`${serverId}\0${rawName}`);
  return `${normalized.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length - 1)}_${suffix}`;
}

function renderMcpResult(
  content: Array<{ type: string; [key: string]: unknown }>,
  structuredContent: unknown,
): string {
  const parts = content.map((block) => {
    if (block.type === "text" && typeof block.text === "string") return block.text;
    const mimeType = typeof block.mimeType === "string" ? block.mimeType : "unknown";
    if (block.type === "image") return `[image: ${mimeType}]`;
    if (block.type === "audio") return `[audio: ${mimeType}]`;
    if (block.type === "resource" || block.type === "resource_link") return "[resource]";
    return `[unsupported MCP content: ${block.type}]`;
  });
  if (parts.length === 0 && structuredContent !== undefined) {
    parts.push(JSON.stringify(structuredContent));
  }
  const output = parts.join("\n") || "(MCP tool returned no content)";
  return output.length <= MAX_TOOL_OUTPUT_LENGTH
    ? output
    : `${output.slice(0, MAX_TOOL_OUTPUT_LENGTH)}\n[output truncated]`;
}

function createDefinition(
  server: McpServerConfig,
  tool: McpTool,
  client: McpClient,
): ToolDefinition {
  const id = publicMcpToolId(server.id, tool.name);
  return {
    id,
    name: id,
    description: tool.description ?? "",
    source: server.transport === "stdio" ? "mcp-local" : "mcp-remote",
    riskLevel: server.transport === "stdio" ? "L3" : "L4",
    requiredCapability: "localMcp",
    approval: {
      target:
        server.transport === "stdio"
          ? `${server.name} · ${server.command}`
          : `${server.name} · ${new URL(server.url).origin}`,
      impact: server.transport === "stdio" ? "local-process-access" : "remote-data-transfer",
      reversible: false,
      ...(server.transport === "streamable-http"
        ? { dataDestination: new URL(server.url).origin }
        : {}),
    },
    schema: tool.inputSchema,
    async execute(args, _runtime, signal) {
      const result = await client.callTool(tool.name, args, signal ? { signal } : {});
      const output = renderMcpResult(result.content, result.structuredContent);
      return result.isError
        ? { success: false, output, error: "mcp_tool_error" }
        : { success: true, output };
    },
  };
}

export class McpToolPublisher {
  private disposers: ComponentDisposer[] = [];
  private definitions: ToolDefinition[] = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: ComponentActivationContext,
    private readonly server: McpServerConfig,
    private readonly client: McpClient,
  ) {}

  replace(tools: readonly McpTool[]): Promise<void> {
    this.pending = this.pending
      .catch(() => undefined)
      .then(() => {
        const definitions = tools.map((tool) => createDefinition(this.server, tool, this.client));
        const ids = new Set<string>();
        for (const definition of definitions) {
          if (ids.has(definition.id)) {
            throw new Error(`MCP tools normalize to the same public name: ${definition.id}`);
          }
          if (
            this.context.hasTool(definition.id) &&
            !this.definitions.some(({ id }) => id === definition.id)
          ) {
            throw new Error(`MCP tool conflicts with an existing registration: ${definition.id}`);
          }
          ids.add(definition.id);
        }
        const previousDefinitions = this.definitions;
        this.clearNow();
        const next: ComponentDisposer[] = [];
        try {
          for (const definition of definitions) next.push(this.context.registerTool(definition));
        } catch (error) {
          for (const dispose of next.reverse()) dispose();
          this.disposers = previousDefinitions.map((definition) =>
            this.context.registerTool(definition),
          );
          this.definitions = previousDefinitions;
          throw error;
        }
        this.disposers = next;
        this.definitions = definitions;
      });
    return this.pending;
  }

  clear(): Promise<void> {
    this.pending = this.pending.catch(() => undefined).then(() => this.clearNow());
    return this.pending;
  }

  waitForIdle(): Promise<void> {
    return this.pending;
  }

  private clearNow(): void {
    for (const dispose of this.disposers.reverse()) dispose();
    this.disposers = [];
    this.definitions = [];
  }
}
