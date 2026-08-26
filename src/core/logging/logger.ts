import packageJson from "../../../package.json";
import { currentPlatform } from "../shortcuts/platform";
import { redactLogValue } from "./redaction";
import type { LogChannel, LogEvent, LogLevel } from "./types";

export interface LogFilter {
  level?: LogLevel;
  channel?: LogChannel;
}

const MAX_ENTRIES = 1000;

export class Logger {
  private readonly buffer: LogEvent[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly sessionId = crypto.randomUUID();

  log(level: LogLevel, channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    const redactedMessage = redactLogValue(message) as string;
    const entry: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      channel,
      event: redactedMessage,
      message: redactedMessage,
      appVersion: packageJson.version,
      platform: currentPlatform(),
      sessionId: this.sessionId,
      ...(data !== undefined ? { data: redactLogValue(data) as Record<string, unknown> } : {}),
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_ENTRIES) {
      this.buffer.shift();
    }
    this.emitChange();
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
