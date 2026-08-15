import { describe, expect, it } from "vitest";
import type { McpServerRecord } from "../../storage/db";
import type { StoragePort } from "../../storage/storage-port";
import { McpServerRepository, parseMcpServerConfig } from "../mcp-repository";

function repository(records: McpServerRecord[]): McpServerRepository {
  return new McpServerRepository({
    readAll: () => Promise.resolve(records),
  } as unknown as StoragePort);
}

describe("McpServerRepository", () => {
  it("returns only enabled, runtime-validated server configurations", async () => {
    const servers = await repository([
      {
        id: "local",
        name: "Local",
        transport: "stdio",
        enabled: 1,
        config: JSON.stringify({ command: "node", args: ["server.mjs"], envSecretRefs: {} }),
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "off",
        name: "Off",
        transport: "streamable-http",
        enabled: 0,
        config: JSON.stringify({ url: "https://example.com/mcp", headerSecretRefs: {} }),
        createdAt: 1,
        updatedAt: 1,
      },
    ]).listEnabled();

    expect(servers).toEqual([
      expect.objectContaining({ id: "local", transport: "stdio", command: "node" }),
    ]);
  });

  it("rejects corrupted enabled records at the repository boundary", async () => {
    const subject = repository([
      {
        id: "broken",
        name: "Broken",
        transport: "stdio",
        enabled: 1,
        config: JSON.stringify({ args: [], envSecretRefs: {} }),
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await expect(subject.listEnabled()).rejects.toThrow("configuration is invalid: broken");
  });

  it("bounds commands, arguments, destinations, and secret references", () => {
    expect(() =>
      parseMcpServerConfig({
        id: "local",
        name: "Local",
        transport: "stdio",
        enabled: true,
        command: "x".repeat(4_097),
        args: [],
        envSecretRefs: {},
      }),
    ).toThrow("configuration is invalid");
    expect(() =>
      parseMcpServerConfig({
        id: "remote",
        name: "Remote",
        transport: "streamable-http",
        enabled: true,
        url: "file:///tmp/mcp",
        headerSecretRefs: {},
      }),
    ).toThrow("configuration is invalid");
  });

  it("accepts UI record metadata but strips it from the runtime configuration", () => {
    const parsed = parseMcpServerConfig({
      id: "local",
      name: "Local",
      transport: "stdio",
      enabled: false,
      command: "node",
      args: ["server.mjs"],
      envSecretRefs: {},
      createdAt: 1,
      updatedAt: 2,
    });

    expect(parsed).toEqual({
      id: "local",
      name: "Local",
      transport: "stdio",
      enabled: false,
      command: "node",
      args: ["server.mjs"],
      envSecretRefs: {},
    });
  });
});
