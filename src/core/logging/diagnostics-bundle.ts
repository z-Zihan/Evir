import { redactLogValue } from "./redaction";
import type { LogEvent } from "./types";

export interface DiagnosticsBundleInput {
  appVersion: string;
  platform: string;
  locale: string;
  target: "web" | "desktop";
  capabilities: readonly string[];
  logPersistence: { active: boolean; directory: string | null };
  /** Provider records; secrets are redacted defensively even though keys live in the OS credential store. */
  providers: ReadonlyArray<unknown>;
  /** MCP server entries; header values are redacted. */
  mcpServers: ReadonlyArray<unknown>;
  /** In-memory recent log events; already redacted by the Logger. */
  recentLogEvents: ReadonlyArray<LogEvent>;
  includePerformanceSummary: boolean;
}

export interface DiagnosticsMetadataFile {
  name: string;
  contents: string;
}

function jsonFile(name: string, value: unknown): DiagnosticsMetadataFile {
  return { name, contents: `${JSON.stringify(value, null, 2)}\n` };
}

function performanceSummary(events: ReadonlyArray<LogEvent>): {
  totalEvents: number;
  byChannel: Record<string, number>;
  byLevel: Record<string, number>;
} {
  const byChannel: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  for (const event of events) {
    byChannel[event.channel] = (byChannel[event.channel] ?? 0) + 1;
    byLevel[event.level] = (byLevel[event.level] ?? 0) + 1;
  }
  return { totalEvents: events.length, byChannel, byLevel };
}

/**
 * Builds the redacted metadata JSON files embedded at the root of the
 * diagnostics bundle. Contents never include API keys, conversations, or file
 * bodies; provider/MCP records pass through the same recursive redaction used
 * for logs.
 */
export function buildDiagnosticsMetadataFiles(
  input: DiagnosticsBundleInput,
): DiagnosticsMetadataFile[] {
  const generatedAt = new Date().toISOString();
  const files: DiagnosticsMetadataFile[] = [
    jsonFile("system.json", {
      generatedAt,
      appVersion: input.appVersion,
      platform: input.platform,
      locale: input.locale,
      target: input.target,
    }),
    jsonFile("runtime-status.json", {
      target: input.target,
      capabilities: input.capabilities,
      logPersistence: {
        active: input.logPersistence.active,
        directory: input.logPersistence.directory,
      },
    }),
    jsonFile("provider-metadata.json", {
      generatedAt,
      count: input.providers.length,
      providers: redactLogValue(input.providers),
    }),
    jsonFile("mcp-status.json", {
      generatedAt,
      count: input.mcpServers.length,
      servers: redactLogValue(input.mcpServers),
    }),
    jsonFile("diagnostics-events.json", {
      generatedAt,
      count: input.recentLogEvents.length,
      events: input.recentLogEvents,
    }),
  ];
  if (input.includePerformanceSummary) {
    files.push(jsonFile("performance-summary.json", performanceSummary(input.recentLogEvents)));
  }
  return files;
}
