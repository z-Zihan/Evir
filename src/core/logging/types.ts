export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogChannel =
  | "app"
  | "ui"
  | "runtime"
  | "provider"
  | "stream"
  | "agent"
  | "context"
  | "memory"
  | "tool"
  | "approval"
  | "filesystem"
  | "process"
  | "git"
  | "mcp"
  | "skill"
  | "computer-use"
  | "storage"
  | "artifact"
  | "notification"
  | "shortcut"
  | "usage"
  | "performance"
  | "update"
  | "security";

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  channel: LogChannel;
  event: string;
  message?: string;
  appVersion: string;
  platform: string;
  sessionId: string;
  conversationId?: string;
  runId?: string;
  stepId?: string;
  toolCallId?: string;
  requestId?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface LoggerPort {
  write(event: LogEvent): void;
  flush(): Promise<void>;
}

export interface DiagnosticExportOptions {
  includeDays: number;
  includeCrashReports: boolean;
  includePerformanceSummary: boolean;
  includeSelectedConversationIds: string[];
  includeRawProtocolCapture: boolean;
}
