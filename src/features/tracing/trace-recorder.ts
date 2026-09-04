import {
  MAX_GAP_SAMPLE,
  MAX_STORED_DELTA_EVENTS,
  MAX_VISIBLE_SEGMENT_CHARS,
  MAX_VISIBLE_SEGMENTS,
  MAX_VISIBLE_TOTAL_CHARS,
  type TraceDeltaKind,
  type TraceEventKind,
  type TraceEventRecord,
  type TraceRecord,
  type TraceToolSummary,
  type TraceVisibleSegment,
} from "./trace-types";
import { useTraceStore } from "./trace-store";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { redactLogValue } from "../../core/logging/redaction";

/**
 * One TraceRecorder per assistant turn. Recorders are registered per
 * conversation (the same keying the multi-task runtime uses for stream slots),
 * so deep call sites (provider stream loop, tool executor, approval flow)
 * append events without threading a parameter through every layer.
 *
 * Writes are batched (§28): the in-memory buffer flushes on a debounce while
 * the turn runs and immediately on finalize; every event keeps its original
 * monotonic `at`/`deltaMs` and wall-clock `receivedAt`.
 */

const FLUSH_DEBOUNCE_MS = 2_000;

const activeTraces = new Map<string, TraceRecorder>();

export interface TraceRecorderOptions {
  providerId?: string;
  modelId?: string;
  mode?: string;
  runId?: string;
  /** false for private sessions: reactive in-memory only, never persisted. */
  persist?: boolean;
}

export class TraceRecorder {
  readonly traceId: string;
  readonly conversationId: string;
  private readonly origin: number;
  private readonly wallStartedAt: number;
  private providerId?: string;
  private modelId?: string;
  private mode?: string;
  private runId?: string;
  private requestIds = new Set<string>();
  private messageIds: string[] = [];
  private events: TraceEventRecord[] = [];
  private tools = new Map<string, TraceToolSummary>();
  private status: TraceRecord["status"] = "running";
  private seq = 0;
  private lastAt = 0;
  private finalized = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Aggregate stats survive the stored-event cap.
  private chunkCount = 0;
  private gapCount = 0;
  private gapTotal = 0;
  private gapMax = 0;
  private gapSample: number[] = [];
  private firstTokenAt: number | undefined;
  private lastDeltaAt: number | undefined;
  private streamingStartAt: number | undefined;
  private outputTokens: number | undefined;
  private approvalWaitStartedAt: number | undefined;
  private approvalWaitMs: number | undefined;
  // Bounded sample of the user-visible text stream (§27). Only provider
  // "text" deltas reach here — reasoning/CoT is never appended.
  private visibleSegments: TraceVisibleSegment[] = [];
  private visibleTotalChars = 0;
  private visibleTruncated = false;
  private readonly persistEnabled: boolean;

  constructor(conversationId: string, options: TraceRecorderOptions = {}) {
    this.traceId = crypto.randomUUID();
    this.conversationId = conversationId;
    this.origin = performance.now();
    this.wallStartedAt = Date.now();
    if (options.providerId !== undefined) this.providerId = options.providerId;
    if (options.modelId !== undefined) this.modelId = options.modelId;
    if (options.mode !== undefined) this.mode = options.mode;
    if (options.runId !== undefined) this.runId = options.runId;
    this.persistEnabled = options.persist !== false;
  }

  attachRun(runId: string | undefined): void {
    if (runId) this.runId = runId;
  }

  attachRequest(requestId: string): void {
    this.requestIds.add(requestId);
  }

  attachMessages(ids: string[]): void {
    for (const id of ids) if (!this.messageIds.includes(id)) this.messageIds.push(id);
  }

  record(
    kind: TraceEventKind,
    detail: {
      status?: TraceEventRecord["status"] | undefined;
      toolCallId?: string | undefined;
      browserSessionId?: string | undefined;
      summary?: string | undefined;
      durationMs?: number | undefined;
      size?: number | undefined;
    } = {},
  ): void {
    if (this.finalized) return;
    const at = performance.now() - this.origin;
    const deltaMs = this.seq === 0 ? 0 : at - this.lastAt;
    this.seq += 1;
    this.lastAt = at;
    this.events.push({
      seq: this.seq,
      at,
      receivedAt: Date.now(),
      deltaMs,
      kind,
      ...(detail.status !== undefined ? { status: detail.status } : {}),
      ...(detail.toolCallId !== undefined ? { toolCallId: detail.toolCallId } : {}),
      ...(detail.browserSessionId !== undefined
        ? { browserSessionId: detail.browserSessionId }
        : {}),
      ...(detail.summary !== undefined ? { summary: detail.summary } : {}),
      ...(detail.durationMs !== undefined ? { durationMs: detail.durationMs } : {}),
      ...(detail.size !== undefined ? { size: detail.size } : {}),
    });
    this.scheduleFlush();
  }

  /**
   * Stream delta timing (§22). Content is never stored — only kind/size plus
   * gap statistics. Beyond MAX_STORED_DELTA_EVENTS the individual events stop
   * accumulating while the aggregate stats keep counting.
   */
  recordDelta(kind: TraceDeltaKind, size: number): void {
    if (this.finalized) return;
    const at = performance.now() - this.origin;
    if (this.firstTokenAt === undefined) {
      this.firstTokenAt = at;
      this.streamingStartAt = at;
      this.record("first-token", { summary: kind });
    }
    this.chunkCount += 1;
    if (this.lastDeltaAt !== undefined) {
      const gap = at - this.lastDeltaAt;
      this.gapCount += 1;
      this.gapTotal += gap;
      this.gapMax = Math.max(this.gapMax, gap);
      if (this.gapSample.length < MAX_GAP_SAMPLE) this.gapSample.push(gap);
    }
    this.lastDeltaAt = at;
    if (this.events.length < MAX_STORED_DELTA_EVENTS) {
      this.record("stream.delta", { summary: kind, size });
    }
  }

  /**
   * User-visible text sample (§27): appends a redacted slice of the visible
   * stream into bounded segments. Only call this for provider `text` deltas —
   * reasoning/CoT content must never reach this method. Caps: segment count,
   * segment length, total chars; the full text remains in the chat message.
   */
  appendVisibleText(delta: string): void {
    if (this.finalized || delta.length === 0) return;
    this.visibleTotalChars += delta.length;
    let remaining = delta;
    while (remaining.length > 0) {
      const storedChars = this.visibleSegments.reduce(
        (total, segment) => total + segment.text.length,
        0,
      );
      if (
        this.visibleSegments.length >= MAX_VISIBLE_SEGMENTS ||
        storedChars >= MAX_VISIBLE_TOTAL_CHARS
      ) {
        this.visibleTruncated = true;
        return;
      }
      const last = this.visibleSegments.at(-1);
      const lastLen = last?.text.length ?? 0;
      // Fill the open segment before opening a new one (segment = ≤160 chars).
      if (last && lastLen < MAX_VISIBLE_SEGMENT_CHARS) {
        const room = MAX_VISIBLE_SEGMENT_CHARS - lastLen;
        const take = Math.min(room, remaining.length);
        // Redaction can expand text; clamp so the schema's max(160) holds.
        last.text = `${last.text}${redactLogValue(remaining.slice(0, take)) as string}`.slice(
          0,
          MAX_VISIBLE_SEGMENT_CHARS,
        );
        remaining = remaining.slice(take);
        continue;
      }
      const take = Math.min(MAX_VISIBLE_SEGMENT_CHARS, remaining.length);
      this.visibleSegments.push({
        at: Math.round(performance.now() - this.origin),
        text: (redactLogValue(remaining.slice(0, take)) as string).slice(
          0,
          MAX_VISIBLE_SEGMENT_CHARS,
        ),
      });
      remaining = remaining.slice(take);
    }
  }

  recordUsage(outputTokens: number | undefined): void {
    if (outputTokens !== undefined) this.outputTokens = outputTokens;
    this.record("usage", {
      summary: outputTokens !== undefined ? `${outputTokens} output tokens` : "usage unavailable",
    });
  }

  toolStarted(toolCallId: string, toolName: string): void {
    this.tools.set(toolCallId, {
      toolCallId,
      toolName,
      startedAt: Date.now(),
      status: "running",
    });
    this.record("tool.started", { toolCallId, summary: toolName });
  }

  toolSettled(
    toolCallId: string,
    outcome: {
      success: boolean;
      durationMs: number;
      errorCategory?: string;
      inputSummary?: string;
      outputSummary?: string;
    },
  ): void {
    const tool = this.tools.get(toolCallId);
    if (tool) {
      tool.status = outcome.success ? "ok" : "error";
      tool.completedAt = Date.now();
      tool.durationMs = outcome.durationMs;
      tool.errorCategory = outcome.errorCategory;
      tool.inputSummary = outcome.inputSummary;
      tool.outputSummary = outcome.outputSummary;
    }
    this.record(outcome.success ? "tool.completed" : "tool.failed", {
      toolCallId,
      status: outcome.success ? "ok" : "error",
      ...(outcome.errorCategory
        ? { summary: `${tool?.toolName ?? toolCallId}: ${outcome.errorCategory}` }
        : tool?.toolName
          ? { summary: tool.toolName }
          : {}),
      durationMs: outcome.durationMs,
    });
  }

  approvalRequested(toolCallId: string, toolName: string): void {
    if (this.approvalWaitStartedAt === undefined)
      this.approvalWaitStartedAt = performance.now() - this.origin;
    this.record("approval.requested", { toolCallId, summary: toolName });
  }

  approvalResolved(decision: "granted" | "denied", toolCallId: string): void {
    if (this.approvalWaitStartedAt !== undefined) {
      const waited = performance.now() - this.origin - this.approvalWaitStartedAt;
      this.approvalWaitMs = Math.max(this.approvalWaitMs ?? 0, waited);
      // A next approval in the same turn restarts the wait window.
      this.approvalWaitStartedAt = performance.now() - this.origin;
    }
    this.record(decision === "granted" ? "approval.granted" : "approval.denied", {
      toolCallId,
      summary: decision === "granted" ? "approved" : "denied",
    });
  }

  finalize(status: TraceRecord["status"]): void {
    if (this.finalized) return;
    this.status = status;
    this.record(status === "failed" ? "turn.failed" : "turn.completed", {
      status: status === "completed" ? "ok" : status === "failed" ? "error" : "cancelled",
    });
    this.finalized = true;
    void this.flush();
  }

  snapshot(): TraceRecord {
    const totalDurationMs = this.finalized ? this.lastAt : performance.now() - this.origin;
    const streamingDurationMs =
      this.streamingStartAt !== undefined ? totalDurationMs - this.streamingStartAt : undefined;
    const sortedGaps = [...this.gapSample].sort((a, b) => a - b);
    const p95GapMs = sortedGaps.length
      ? sortedGaps[Math.min(sortedGaps.length - 1, Math.ceil(0.95 * (sortedGaps.length - 1)))]
      : undefined;
    return {
      id: this.traceId,
      version: 1,
      conversationId: this.conversationId,
      messageIds: [...this.messageIds],
      ...(this.runId ? { runId: this.runId } : {}),
      ...(this.providerId ? { providerId: this.providerId } : {}),
      ...(this.modelId ? { modelId: this.modelId } : {}),
      ...(this.mode ? { mode: this.mode } : {}),
      requestIds: [...this.requestIds],
      startedAt: this.wallStartedAt,
      ...(this.finalized ? { completedAt: Date.now() } : {}),
      status: this.status,
      events: [...this.events],
      tools: [...this.tools.values()],
      ...(this.visibleSegments.length > 0
        ? {
            visibleOutput: {
              segments: this.visibleSegments.map((segment) => ({ ...segment })),
              truncated: this.visibleTruncated,
              totalChars: this.visibleTotalChars,
            },
          }
        : {}),
      metrics: {
        totalDurationMs: Math.round(totalDurationMs),
        ...(this.firstTokenAt !== undefined ? { ttfbMs: Math.round(this.firstTokenAt) } : {}),
        ...(streamingDurationMs !== undefined && streamingDurationMs >= 0
          ? { streamingDurationMs: Math.round(streamingDurationMs) }
          : {}),
        chunkCount: this.chunkCount,
        ...(this.gapCount > 0
          ? { avgGapMs: Math.round((this.gapTotal / this.gapCount) * 10) / 10 }
          : {}),
        ...(this.gapMax > 0 ? { maxGapMs: Math.round(this.gapMax) } : {}),
        ...(p95GapMs !== undefined ? { p95GapMs: Math.round(p95GapMs) } : {}),
        ...(this.outputTokens !== undefined ? { outputTokens: this.outputTokens } : {}),
        ...(this.outputTokens !== undefined &&
        streamingDurationMs !== undefined &&
        streamingDurationMs > 0
          ? {
              tokensPerSecond:
                Math.round((this.outputTokens / (streamingDurationMs / 1000)) * 10) / 10,
            }
          : {}),
        ...(this.approvalWaitMs !== undefined
          ? { approvalWaitMs: Math.round(this.approvalWaitMs) }
          : {}),
      },
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.finalized) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Publish the snapshot to the reactive store + structured storage. */
  async flush(): Promise<void> {
    const snapshot = this.snapshot();
    useTraceStore.getState().upsertTrace(snapshot);
    if (!this.persistEnabled) return;
    try {
      await getStructuredStorage().write("traces", this.traceId, snapshot);
    } catch {
      // Trace persistence must never break streaming; the in-memory copy in
      // the trace store still serves the UI for this session.
    }
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

/**
 * Begin a trace for a conversation's next assistant turn. Any stale running
 * trace (crashed/interrupted turn) is finalized as stopped first.
 */
export function beginTrace(conversationId: string, options?: TraceRecorderOptions): TraceRecorder {
  const stale = activeTraces.get(conversationId);
  if (stale) {
    stale.finalize("stopped");
    stale.dispose();
    activeTraces.delete(conversationId);
  }
  const recorder = new TraceRecorder(conversationId, options);
  recorder.record("turn.started", {
    ...(options?.mode ? { summary: `mode: ${options.mode}` } : {}),
  });
  activeTraces.set(conversationId, recorder);
  return recorder;
}

/** The conversation's active trace, if a turn is in flight. */
export function activeTraceFor(conversationId: string): TraceRecorder | undefined {
  return activeTraces.get(conversationId);
}

/** Finalize + unregister the conversation's active trace. */
export function completeTrace(conversationId: string, status: TraceRecord["status"]): void {
  const recorder = activeTraces.get(conversationId);
  if (!recorder) return;
  recorder.finalize(status);
  recorder.dispose();
  activeTraces.delete(conversationId);
}
