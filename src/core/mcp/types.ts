export type McpTransport = "stdio" | "streamable-http";

export interface McpServerBase {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
}

export interface StdioMcpServer extends McpServerBase {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string | undefined;
  envSecretRefs: Record<string, string>;
}

export interface HttpMcpServer extends McpServerBase {
  transport: "streamable-http";
  url: string;
  headerSecretRefs: Record<string, string>;
}

export type McpServerConfig = StdioMcpServer | HttpMcpServer;

export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
}
