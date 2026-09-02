import { describe, expect, it } from "vitest";
import { buildDiagnosticsMetadataFiles } from "../diagnostics-bundle";
import type { LogEvent } from "../types";

function logEvent(channel: LogEvent["channel"], level: LogEvent["level"]): LogEvent {
  return {
    timestamp: "2026-08-27T10:00:00.000Z",
    level,
    channel,
    event: "test.event",
    appVersion: "0.1.0",
    platform: "mac",
    sessionId: "session-1",
    windowId: "window-1",
  };
}

const INPUT = {
  appVersion: "0.1.0",
  platform: "mac" as const,
  locale: "zh-CN",
  target: "desktop" as const,
  capabilities: ["chat", "filesystem"],
  logPersistence: { active: true, directory: "/tmp/logs" },
  providers: [
    {
      id: "provider-1",
      name: "OpenAI",
      protocol: "openai-chat-completions",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-secret-secret-secret",
      modelId: "gpt-4o",
    },
  ],
  mcpServers: [
    {
      id: "mcp-1",
      name: "fs",
      transport: "stdio",
      enabled: true,
      headers: { Authorization: "Bearer abcdef123456" },
    },
  ],
  recentLogEvents: [
    logEvent("provider", "info"),
    logEvent("provider", "error"),
    logEvent("tool", "info"),
  ],
};

function parseFile(files: Array<{ name: string; contents: string }>, name: string) {
  const file = files.find((candidate) => candidate.name === name);
  expect(file, name).toBeDefined();
  return JSON.parse(file?.contents ?? "{}") as Record<string, unknown>;
}

describe("buildDiagnosticsMetadataFiles", () => {
  it("produces the standard metadata file set with performance summary", () => {
    const files = buildDiagnosticsMetadataFiles({ ...INPUT, includePerformanceSummary: true });
    expect(files.map((file) => file.name)).toEqual([
      "system.json",
      "runtime-status.json",
      "provider-metadata.json",
      "mcp-status.json",
      "diagnostics-events.json",
      "performance-summary.json",
    ]);

    const system = parseFile(files, "system.json");
    expect(system["appVersion"]).toBe("0.1.0");
    expect(system["platform"]).toBe("mac");
    expect(String(system["generatedAt"])).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const runtime = parseFile(files, "runtime-status.json");
    expect(runtime["capabilities"]).toEqual(["chat", "filesystem"]);
    expect(runtime["logPersistence"]).toEqual({ active: true, directory: "/tmp/logs" });

    const summary = parseFile(files, "performance-summary.json");
    expect(summary).toEqual({
      totalEvents: 3,
      byChannel: { provider: 2, tool: 1 },
      byLevel: { info: 2, error: 1 },
    });
  });

  it("omits the performance summary when not requested", () => {
    const files = buildDiagnosticsMetadataFiles({ ...INPUT, includePerformanceSummary: false });
    expect(files.some((file) => file.name === "performance-summary.json")).toBe(false);
  });

  it("redacts provider api keys and mcp authorization headers", () => {
    const files = buildDiagnosticsMetadataFiles({ ...INPUT, includePerformanceSummary: true });

    const providers = parseFile(files, "provider-metadata.json");
    const providerList = providers["providers"] as Array<Record<string, unknown>>;
    expect(providerList[0]?.["apiKey"]).toBe("[REDACTED]");
    expect(providerList[0]?.["protocol"]).toBe("openai-chat-completions");

    const mcp = parseFile(files, "mcp-status.json");
    const servers = mcp["servers"] as Array<Record<string, unknown>>;
    const headers = servers[0]?.["headers"] as Record<string, unknown>;
    expect(headers["Authorization"]).toBe("[REDACTED]");
    expect(servers[0]?.["transport"]).toBe("stdio");
  });

  it("embeds the recent redacted events with a count", () => {
    const files = buildDiagnosticsMetadataFiles({ ...INPUT, includePerformanceSummary: false });
    const events = parseFile(files, "diagnostics-events.json");
    expect(events["count"]).toBe(3);
    expect((events["events"] as unknown[]).length).toBe(3);
  });
});
