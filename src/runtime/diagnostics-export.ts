import {
  buildDiagnosticsMetadataFiles,
  type DiagnosticsBundleInput,
} from "../core/logging/diagnostics-bundle";
import {
  DiagnosticExportCancelledError,
  type DiagnosticExportPort,
} from "../core/logging/diagnostic-port";
import { logger } from "../core/logging/logger";
import type { DiagnosticExportOptions, LogChannel } from "../core/logging/types";

export type DiagnosticsBundleSource = () => Omit<
  DiagnosticsBundleInput,
  "includePerformanceSummary"
>;

interface LogsOverviewCommandResult {
  files: Array<{ name: string; bytes: number }>;
  totalBytes: number;
}

interface ExportZipCommandResult {
  zipPath: string;
  fileCount: number;
  totalBytes: number;
  logFiles: Array<{ name: string; bytes: number }>;
  manifest: Record<string, unknown>;
}

function dayStamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDayFor(options: DiagnosticExportOptions): string {
  const cutoff = new Date(Date.now() - options.includeDays * 24 * 60 * 60 * 1000);
  return dayStamp(cutoff);
}

/**
 * Desktop DiagnosticExportPort adapter: the Rust side packs the on-disk JSONL
 * logs; the webview side contributes redacted metadata JSON files and the
 * native save dialog.
 */
export class DesktopDiagnosticsExport implements DiagnosticExportPort {
  private readonly bundleSource: DiagnosticsBundleSource;

  constructor(bundleSource: DiagnosticsBundleSource) {
    this.bundleSource = bundleSource;
  }

  async previewExport(options: DiagnosticExportOptions): Promise<{
    fileCount: number;
    estimatedSize: number;
    channels: LogChannel[];
  }> {
    const { invoke } = await import("@tauri-apps/api/core");
    const overview = await invoke<LogsOverviewCommandResult>("diagnostics_logs_overview", {
      fromDay: fromDayFor(options),
    });
    const channels = new Set<LogChannel>(logger.getEntries().map((entry) => entry.channel));
    return {
      fileCount: overview.files.length,
      estimatedSize: overview.totalBytes,
      channels: [...channels],
    };
  }

  async generateExport(options: DiagnosticExportOptions): Promise<{
    zipPath: string;
    manifest: Record<string, unknown>;
  }> {
    const [{ invoke }, { save }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/plugin-dialog"),
    ]);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const destPath = await save({
      defaultPath: `Evir-Diagnostics-${stamp}.zip`,
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
    });
    if (destPath === null) throw new DiagnosticExportCancelledError();

    const metadataFiles = buildDiagnosticsMetadataFiles({
      ...this.bundleSource(),
      includePerformanceSummary: options.includePerformanceSummary,
    });
    const result = await invoke<ExportZipCommandResult>("diagnostics_export_zip", {
      destPath,
      metadataFiles,
      fromDay: fromDayFor(options),
      includeCrashReports: options.includeCrashReports,
    });
    return { zipPath: result.zipPath, manifest: result.manifest };
  }
}
