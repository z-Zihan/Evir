import type { DiagnosticExportOptions, LogChannel, LogEvent } from "./types";

export interface DiagnosticExportPort {
  generateExport(options: DiagnosticExportOptions): Promise<{
    zipPath: string;
    manifest: Record<string, unknown>;
  }>;
  previewExport(options: DiagnosticExportOptions): Promise<{
    fileCount: number;
    estimatedSize: number;
    channels: LogChannel[];
  }>;
}

export interface DiagnosticLogEntry {
  event: LogEvent;
  redacted: boolean;
}
