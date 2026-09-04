/**
 * LLM turn trace model (§19-32): one TraceRecord per assistant turn, capturing
 * provider request/stream chunk timing, tool executions, approval waits and
 * outcome — all correlated by traceId/conversationId/messageId/runId.
 *
 * Privacy contract (§23, §26): events carry METADATA ONLY — kinds, sizes,
 * timings, tool names, statuses. Never conversation text, never tool payloads,
 * never hidden chain-of-thought (visible reasoning is recorded only when the
 * provider explicitly returns a reasoning stream kind). Raw provider payloads
 * are not captured at all in v1.
 */
import { z } from "zod";

export const TRACE_EVENT_KINDS = [
  "turn.started",
  "request.started",
  "request.retry",
  "first-token",
  "stream.delta",
  "stream.reasoning-delta",
  "tool-call.created",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "usage",
  "stream.completed",
  "stream.error",
  "turn.completed",
  "turn.failed",
] as const;

export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number];

/** Delta kinds distinguish visible content classes (§22). */
export type TraceDeltaKind = "text" | "reasoning" | "tool-call-arguments";

export interface TraceEventRecord {
  seq: number;
  /** Monotonic ms since the trace origin (performance.now based) — timing math. */
  at: number;
  /** Wall-clock capture preserved for display (Date.now based). */
  receivedAt: number;
  /** Gap from the previous recorded event, monotonic ms. */
  deltaMs: number;
  kind: TraceEventKind;
  status?: "ok" | "error" | "cancelled" | undefined;
  toolCallId?: string | undefined;
  browserSessionId?: string | undefined;
  /** Metadata-only summary (tool names, counts, sizes — never content). */
  summary?: string | undefined;
  /** Payload size in bytes/chars for stream deltas. */
  size?: number | undefined;
  /** Span duration for settled events (tools, requests). */
  durationMs?: number | undefined;
}

export interface TraceToolSummary {
  toolCallId: string;
  toolName: string;
  startedAt: number;
  completedAt?: number | undefined;
  durationMs?: number | undefined;
  status: "running" | "ok" | "error" | "cancelled";
  errorCategory?: string | undefined;
  inputSummary?: string | undefined;
  outputSummary?: string | undefined;
}

export interface TraceMetrics {
  totalDurationMs?: number | undefined;
  ttfbMs?: number | undefined;
  streamingDurationMs?: number | undefined;
  chunkCount?: number | undefined;
  avgGapMs?: number | undefined;
  maxGapMs?: number | undefined;
  p95GapMs?: number | undefined;
  tokensPerSecond?: number | undefined;
  outputTokens?: number | undefined;
  approvalWaitMs?: number | undefined;
}

export interface TraceRecord {
  id: string;
  version: 1;
  conversationId: string;
  messageIds: string[];
  runId?: string | undefined;
  providerId?: string | undefined;
  modelId?: string | undefined;
  mode?: string | undefined;
  requestIds: string[];
  startedAt: number;
  completedAt?: number | undefined;
  status: "running" | "completed" | "failed" | "stopped";
  events: TraceEventRecord[];
  tools: TraceToolSummary[];
  metrics: TraceMetrics;
}

export const traceEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  at: z.number().nonnegative(),
  receivedAt: z.number().int().nonnegative(),
  deltaMs: z.number().nonnegative(),
  kind: z.enum(TRACE_EVENT_KINDS),
  status: z.enum(["ok", "error", "cancelled"]).optional(),
  toolCallId: z.string().optional(),
  browserSessionId: z.string().optional(),
  summary: z.string().optional(),
  size: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});

export const traceToolSummarySchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  status: z.enum(["running", "ok", "error", "cancelled"]),
  errorCategory: z.string().optional(),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
});

export const traceRecordSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  conversationId: z.string(),
  messageIds: z.array(z.string()),
  runId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  mode: z.string().optional(),
  requestIds: z.array(z.string()),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  status: z.enum(["running", "completed", "failed", "stopped"]),
  events: z.array(traceEventSchema),
  tools: z.array(traceToolSummarySchema),
  metrics: z.object({
    totalDurationMs: z.number().nonnegative().optional(),
    ttfbMs: z.number().nonnegative().optional(),
    streamingDurationMs: z.number().nonnegative().optional(),
    chunkCount: z.number().int().nonnegative().optional(),
    avgGapMs: z.number().nonnegative().optional(),
    maxGapMs: z.number().nonnegative().optional(),
    p95GapMs: z.number().nonnegative().optional(),
    tokensPerSecond: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    approvalWaitMs: z.number().nonnegative().optional(),
  }),
});

/** Bounded per-trace memory: beyond this, deltas only feed aggregate stats. */
export const MAX_STORED_DELTA_EVENTS = 500;
/** Gap sample ceiling for percentile math on very long streams. */
export const MAX_GAP_SAMPLE = 2_048;
/** Retention: traces older than this are dropped on cleanup (§27). */
export const TRACE_RETENTION_DAYS = 14;
/** Hard cap on stored traces per profile storage namespace. */
export const TRACE_MAX_RECORDS = 500;
