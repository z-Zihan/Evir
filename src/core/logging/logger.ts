import packageJson from "../../../package.json";
import { currentPlatform } from "../shortcuts/platform";
import { redactLogValue } from "./redaction";
import type { LogCategory, LogChannel, LogEvent, LogLevel, LogSink } from "./types";

export interface LogFilter {
  level?: LogLevel;
  channel?: LogChannel;
}

const MAX_ENTRIES = 1000;
const MAX_QUEUE = 500;
const FLUSH_THRESHOLD = 25;
const FLUSH_INTERVAL_MS = 2000;
const MAX_SINK_FAILURES = 3;

const AUDIT_CHANNELS: ReadonlySet<LogChannel> = new Set([
  "approval",
  "tool",
  "security",
  "computer-use",
]);
const PERFORMANCE_CHANNELS: ReadonlySet<LogChannel> = new Set(["usage", "performance"]);

export function logCategoryOf(channel: LogChannel): LogCategory {
  if (AUDIT_CHANNELS.has(channel)) return "audit";
  if (PERFORMANCE_CHANNELS.has(channel)) return "performance";
  return "app";
}

interface QueuedLine {
  category: LogCategory;
  line: string;
}

export class Logger {
  private readonly buffer: LogEvent[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly sessionId = crypto.randomUUID();
  private sink: LogSink | undefined;
  private sinkDisabled = false;
  private sinkFailures = 0;
  private queue: QueuedLine[] = [];
  private droppedCount = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private currentFlush: Promise<void> = Promise.resolve();

  log(level: LogLevel, channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    const redactedMessage = redactLogValue(message) as string;
    const redactedData =
      data === undefined ? undefined : (redactLogValue(data) as Record<string, unknown>);
    const correlation = redactedData ?? {};
    const stringField = (key: string) =>
      typeof correlation[key] === "string" ? correlation[key] : undefined;
    const conversationId = stringField("conversationId");
    const runId = stringField("runId");
    const stepId = stringField("stepId");
    const toolCallId = stringField("toolCallId");
    const requestId = stringField("requestId");
    const durationMs =
      typeof correlation.durationMs === "number" ? correlation.durationMs : undefined;
    const entry: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      channel,
      event: redactedMessage,
      message: redactedMessage,
      appVersion: packageJson.version,
      platform: currentPlatform(),
      sessionId: this.sessionId,
      ...(conversationId ? { conversationId } : {}),
      ...(runId ? { runId } : {}),
      ...(stepId ? { stepId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(redactedData !== undefined ? { data: redactedData } : {}),
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_ENTRIES) {
      this.buffer.shift();
    }
    this.enqueue(entry);
    this.emitChange();
  }

  attachSink(sink: LogSink): void {
    this.sink = sink;
    this.sinkDisabled = false;
    this.sinkFailures = 0;
    void this.flush();
  }

  persistenceStatus(): { active: boolean; directory: string | null } {
    return {
      active: this.sink !== undefined && !this.sinkDisabled,
      directory: this.sink?.directory ?? null,
    };
  }

  debug(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    this.log("debug", channel, message, data);
  }

  info(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    this.log("info", channel, message, data);
  }

  warn(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    this.log("warn", channel, message, data);
  }

  error(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    this.log("error", channel, message, data);
  }

  getEntries(filter?: LogFilter): LogEvent[] {
    if (!filter) {
      return [...this.buffer];
    }
    return this.buffer.filter(
      (entry) =>
        (filter.level === undefined || entry.level === filter.level) &&
        (filter.channel === undefined || entry.channel === filter.channel),
    );
  }

  clear(): void {
    this.buffer.length = 0;
    this.emitChange();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const previous = this.currentFlush;
    const run = previous.catch(() => undefined).then(() => this.drainQueue());
    this.currentFlush = run;
    return run;
  }

  private drainQueue: () => Promise<void> = async () => {
    if (this.sink === undefined || this.sinkDisabled) {
      this.queue.length = 0;
      return;
    }
    while (this.queue.length > 0 && this.sink !== undefined && !this.sinkDisabled) {
      const batch = this.queue;
      this.queue = [];
      for (const queued of batch) {
        try {
          await this.sink.append(queued.category, queued.line);
          this.sinkFailures = 0;
        } catch {
          this.sinkFailures += 1;
          if (this.sinkFailures >= MAX_SINK_FAILURES) {
            this.sinkDisabled = true;
            this.buffer.push({
              timestamp: new Date().toISOString(),
              level: "warn",
              channel: "app",
              event: "app.log-persistence-disabled",
              message: "app.log-persistence-disabled",
              appVersion: packageJson.version,
              platform: currentPlatform(),
              sessionId: this.sessionId,
              data: { droppedCount: this.droppedCount },
            });
            this.emitChange();
            return;
          }
        }
      }
    }
  };

  private enqueue(entry: LogEvent): void {
    if (this.sinkDisabled) return;
    // Queue even before a sink attaches so startup events persist once the
    // desktop file sink is ready; the cap keeps the pre-attach window bounded.
    this.queue.push({ category: logCategoryOf(entry.channel), line: JSON.stringify(entry) });
    if (this.queue.length > MAX_QUEUE) {
      const removed = this.queue.length - MAX_QUEUE;
      this.queue.splice(0, removed);
      this.droppedCount += removed;
    }
    if (this.sink === undefined) return;
    const flushNow =
      entry.level === "error" || entry.level === "fatal" || AUDIT_CHANNELS.has(entry.channel);
    if (flushNow || this.queue.length >= FLUSH_THRESHOLD) {
      void this.flush();
      return;
    }
    if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  exportLogs(): string {
    return JSON.stringify(this.buffer);
  }
}

type LoggerGlobal = typeof globalThis & {
  __evirLogger?: Logger;
};

const loggerGlobal = globalThis as LoggerGlobal;

export const logger = (loggerGlobal.__evirLogger ??= new Logger());
