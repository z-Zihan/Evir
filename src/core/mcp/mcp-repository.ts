import { z } from "zod";
import type { McpServerRecord } from "../storage/db";
import type { StoragePort } from "../storage/storage-port";
import type { McpServerConfig } from "./types";

const SecretRefsSchema = z
  .record(z.string().min(1).max(256), z.string().min(1).max(512))
  .refine((refs) => Object.keys(refs).length <= 128);

const BaseServerSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.-]+$/),
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
  })
  .strip();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const ServerSchema = z.discriminatedUnion("transport", [
  BaseServerSchema.extend({
    transport: z.literal("stdio"),
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().max(8_192)).max(256),
    cwd: z.string().min(1).max(4_096).optional(),
    envSecretRefs: SecretRefsSchema,
  }),
  BaseServerSchema.extend({
    transport: z.literal("streamable-http"),
    url: z.string().max(4_096).refine(isHttpUrl),
    headerSecretRefs: SecretRefsSchema,
  }),
]);

export function parseMcpServerConfig(value: unknown): McpServerConfig {
  const parsed = ServerSchema.safeParse(value);
  if (!parsed.success) throw new Error("MCP server configuration is invalid");
  return parsed.data;
}

function parseRecord(record: McpServerRecord): McpServerConfig {
  let config: unknown;
  try {
    config = JSON.parse(record.config);
  } catch {
    throw new Error(`MCP server configuration is not valid JSON: ${record.id}`);
  }
  try {
    return parseMcpServerConfig({
      id: record.id,
      name: record.name,
      transport: record.transport,
      enabled: record.enabled === 1,
      ...(typeof config === "object" && config !== null ? config : {}),
    });
  } catch {
    throw new Error(`MCP server configuration is invalid: ${record.id}`);
  }
}

export class McpServerRepository {
  constructor(private readonly storage: StoragePort) {}

  async listEnabled(): Promise<McpServerConfig[]> {
    const records = await this.storage.readAll<McpServerRecord>("mcp_servers");
    const servers: McpServerConfig[] = [];
    for (const record of records) {
      if (record.enabled !== 1) continue;
      servers.push(parseRecord(record));
    }
    return servers;
  }
}
