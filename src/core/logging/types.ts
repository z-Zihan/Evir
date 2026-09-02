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
  | "workspace"
  | "browser"
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
  windowId: string;
  conversationId?: string;
  threadId?: string;
  projectId?: string;
  runId?: string;
  planId?: string;
  stepId?: string;
  toolCallId?: string;
  requestId?: string;
  browserSessionId?: string;
  actionId?: string;
  evidenceId?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface LogCorrelation {
  projectId?: string;
  runId?: string;
  planId?: string;
  browserSessionId?: string;
  actionId?: string;
}

export interface LoggerPort {
  write(event: LogEvent): void;
  flush(): Promise<void>;
}

export type LogCategory = "app" | "audit" | "performance";

export interface LogSink {
  append(category: LogCategory, line: string): Promise<void>;
  readonly directory?: string;
}

export interface DiagnosticExportOptions {
  includeDays: number;
  includeCrashReports: boolean;
  includePerformanceSummary: boolean;
  includeSelectedConversationIds: string[];
  includeRawProtocolCapture: boolean;
}
