import { redactLogValue } from "./redaction";
import type { Logger } from "./logger";
import type { LogChannel, LogEvent, LogLevel } from "./types";

const DEFAULT_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bAuthorization\s*:\s*[^\n\r]+/gi,
  /\bCookie\s*:\s*[^\n\r]+/gi,
  /\bSet-Cookie\s*:\s*[^\n\r]+/gi,
  /\b[A-Z][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)/g,
  /\/(?:home|Users)\/[^\s"'`)]+/g,
];

export class RedactionMiddleware {
  private readonly patterns: RegExp[] = [...DEFAULT_PATTERNS];

  constructor(private readonly logger: Logger) {}

  addPattern(pattern: RegExp): void {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    this.patterns.push(new RegExp(pattern.source, flags));
  }

  redact(input: string): string {
    return this.patterns.reduce(
      (current, pattern) => current.replace(pattern, "[REDACTED]"),
      input,
    );
  }

  redactEntry(entry: LogEvent): LogEvent {
    return redactLogValue(this.redactDeep(entry)) as LogEvent;
  }

  private redactDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (typeof value === "string") {
      return this.redact(value);
    }

    if (Array.isArray(value)) {
      if (seen.has(value)) return "[CIRCULAR]";
      seen.add(value);
      return value.map((entryValue) => this.redactDeep(entryValue, seen));
    }

    if (value !== null && typeof value === "object") {
      if (seen.has(value)) return "[CIRCULAR]";
      seen.add(value);
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [key, this.redactDeep(entryValue, seen)]),
      );
    }

    return value;
  }

  log(level: LogLevel, channel: LogChannel, message: string, data?: Record<string, unknown>): void {
    this.logger.log(
      level,
      channel,
      this.redact(message),
      data ? (this.redactDeep(data) as Record<string, unknown>) : data,
    );
  }
}
