import type { LogCategory, LogSink } from "../core/logging/types";

export interface FileLogSinkFsOps {
  mkdir: (dir: string) => Promise<void>;
  appendFile: (path: string, contents: string) => Promise<void>;
  readDir?: (dir: string) => Promise<string[]>;
  removeFile?: (path: string) => Promise<void>;
  statSize?: (path: string) => Promise<number>;
}

export interface FileLogSinkOptions {
  directory: string;
  fsOps: FileLogSinkFsOps;
  now?: () => Date;
  maxFileBytes?: number;
  retentionDays?: number;
  totalBudgetBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 15 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_TOTAL_BUDGET_BYTES = 100 * 1024 * 1024;
const MAX_ROTATION_SUFFIX = 99;

const LOG_FILE_PATTERN = /^(app|audit|performance)-(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?\.jsonl$/;

function localDateStamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function joinPath(directory: string, fileName: string): string {
  return directory.endsWith("/") ? `${directory}${fileName}` : `${directory}/${fileName}`;
}

function fileDayNumber(fileName: string): number | null {
  const match = LOG_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const [, , year, month, day] = match;
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed) ? null : parsed;
}

const encoder = new TextEncoder();

interface KnownFile {
  name: string;
  bytes: number;
}

/**
 * Persists redacted JSONL log lines into per-category, per-day files under a
 * logs directory. Retention and budget cleanup are best-effort: cleanup
 * failures never block appends.
 */
export class FileLogSink implements LogSink {
  readonly directory: string;
  private readonly fsOps: FileLogSinkFsOps;
  private readonly now: () => Date;
  private readonly maxFileBytes: number;
  private readonly retentionDays: number;
  private readonly totalBudgetBytes: number;
  private readonly activeFiles = new Map<string, KnownFile>();
  private initialized = false;
  private initPromise: Promise<void> | undefined;

  constructor(options: FileLogSinkOptions) {
    this.directory = options.directory;
    this.fsOps = options.fsOps;
    this.now = options.now ?? (() => new Date());
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.totalBudgetBytes = options.totalBudgetBytes ?? DEFAULT_TOTAL_BUDGET_BYTES;
  }

  async append(category: LogCategory, line: string): Promise<void> {
    await this.ensureReady();
    const file = await this.resolveFile(category);
    const payload = `${line}\n`;
    await this.fsOps.appendFile(joinPath(this.directory, file.name), payload);
    file.bytes += encoder.encode(payload).length;
  }

  private ensureReady(): Promise<void> {
    this.initPromise ??= this.initialize().then(
      () => {
        this.initialized = true;
      },
      (error: unknown) => {
        this.initPromise = undefined;
        throw error;
      },
    );
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    await this.fsOps.mkdir(this.directory);
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    const { readDir, removeFile, statSize } = this.fsOps;
    if (readDir === undefined || removeFile === undefined || statSize === undefined) return;
    try {
      const names = await readDir(this.directory);
      const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
      const candidates: Array<{ name: string; day: number; rotation: number; bytes: number }> = [];
      for (const name of names) {
        const match = LOG_FILE_PATTERN.exec(name);
        if (!match) continue;
        const day = fileDayNumber(name);
        if (day === null) continue;
        const bytes = await statSize(joinPath(this.directory, name)).catch(() => 0);
        if (day < cutoff) {
          await removeFile(joinPath(this.directory, name)).catch(() => undefined);
          continue;
        }
        candidates.push({
          name,
          day,
          rotation: match[5] ? Number(match[5]) : 0,
          bytes,
        });
      }
      let totalBytes = candidates.reduce((sum, file) => sum + file.bytes, 0);
      if (totalBytes <= this.totalBudgetBytes) return;
      candidates.sort((a, b) => a.day - b.day || a.rotation - b.rotation);
      for (const file of candidates) {
        if (totalBytes <= this.totalBudgetBytes) break;
        const removed = await removeFile(joinPath(this.directory, file.name)).then(
          () => true,
          () => false,
        );
        if (removed) totalBytes -= file.bytes;
      }
    } catch {
      // Retention cleanup is best-effort; append must continue on failure.
    }
  }

  private async resolveFile(category: LogCategory): Promise<KnownFile> {
    const stamp = localDateStamp(this.now());
    const mapKey = `${category}-${stamp}`;
    const primaryName = `${mapKey}.jsonl`;
    const primary = this.activeFiles.get(mapKey);
    if (primary && primary.bytes < this.maxFileBytes) return primary;

    const sizeOf = async (name: string): Promise<number> => {
      if (this.fsOps.statSize) {
        return this.fsOps.statSize(joinPath(this.directory, name)).catch(() => 0);
      }
      return 0;
    };

    if (!primary) {
      const bytes = await sizeOf(primaryName);
      if (bytes < this.maxFileBytes) {
        const known = { name: primaryName, bytes };
        this.activeFiles.set(mapKey, known);
        return known;
      }
    } else {
      this.activeFiles.delete(mapKey);
    }

    for (let rotation = 1; rotation <= MAX_ROTATION_SUFFIX; rotation += 1) {
      const name = `${mapKey}.${rotation}.jsonl`;
      const bytes = await sizeOf(name);
      if (bytes < this.maxFileBytes) {
        const known = { name, bytes };
        this.activeFiles.set(mapKey, known);
        return known;
      }
    }
    const last = {
      name: `${mapKey}.${MAX_ROTATION_SUFFIX}.jsonl`,
      bytes: Number.MAX_SAFE_INTEGER - this.maxFileBytes,
    };
    this.activeFiles.set(mapKey, last);
    return last;
  }
}

export async function createDesktopFileLogSink(): Promise<FileLogSink> {
  const [{ appDataDir, join }, fs] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const directory = await join(await appDataDir(), "logs");
  return new FileLogSink({
    directory,
    fsOps: {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }),
      appendFile: (path, contents) => fs.writeTextFile(path, contents, { append: true }),
      readDir: async (dir) => {
        const entries = await fs.readDir(dir);
        return entries.map((entry) => entry.name);
      },
      removeFile: (path) => fs.remove(path),
      statSize: async (path) => (await fs.stat(path)).size,
    },
  });
}
