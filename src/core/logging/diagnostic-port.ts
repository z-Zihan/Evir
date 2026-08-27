import type { DiagnosticExportOptions, LogChannel, LogEvent } from "./types";

/** Thrown when the user dismisses the save dialog; not an export failure. */
export class DiagnosticExportCancelledError extends Error {
  constructor() {
    super("diagnostics export cancelled by user");
    this.name = "DiagnosticExportCancelledError";
  }
}

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
