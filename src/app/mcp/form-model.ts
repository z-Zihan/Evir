import type { TFunction } from "i18next";
import type { McpTool, McpTransport } from "../../core/mcp/types";
import type { ToolResult } from "../../core/providers/tool-registry";

/** Shared view-model for the MCP server form + server cards (§6 split). */

export interface McpFormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
}

export const EMPTY_MCP_FORM: McpFormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  url: "",
};

export type McpFormErrors = Partial<Record<"name" | "command" | "url", string>>;

export interface McpToolTestState {
  input: string;
  running?: boolean | undefined;
  error?: string | undefined;
  result?: ToolResult | undefined;
}

export const MAX_SCHEMA_PREVIEW_CHARS = 4_000;
export const MAX_CONFIRMATION_ARGS_CHARS = 500;

export function toolTestKey(serverId: string, toolName: string): string {
  return `${serverId}\0${toolName}`;
}

export function schemaPreview(tool: McpTool): string {
  const value = JSON.stringify(tool.inputSchema, null, 2);
  return value.length <= MAX_SCHEMA_PREVIEW_CHARS
    ? value
    : `${value.slice(0, MAX_SCHEMA_PREVIEW_CHARS)}\n…`;
}

export function validateMcpForm(form: McpFormState, t: TFunction): McpFormErrors {
  const next: McpFormErrors = {};
  if (!form.name.trim()) next.name = t("mcp.required");
  if (form.transport === "stdio" && !form.command.trim()) next.command = t("mcp.required");
  if (form.transport === "streamable-http") {
    try {
      const url = new URL(form.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") next.url = t("mcp.invalidUrl");
    } catch {
      next.url = form.url.trim() ? t("mcp.invalidUrl") : t("mcp.required");
    }
  }
  return next;
}

export type McpServerConfigInput = ReturnType<typeof buildMcpConfig>;

export function buildMcpConfig(form: McpFormState) {
  return form.transport === "stdio"
    ? {
        name: form.name.trim(),
        transport: "stdio" as const,
        command: form.command.trim(),
        args: form.args
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
        envSecretRefs: {},
      }
    : {
        name: form.name.trim(),
        transport: "streamable-http" as const,
        url: form.url.trim(),
        headerSecretRefs: {},
      };
}
