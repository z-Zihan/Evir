// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STORED_DELTA_EVENTS,
  TRACE_MAX_RECORDS,
  TRACE_RETENTION_DAYS,
  traceRecordSchema,
  type TraceRecord,
} from "../trace-types";

const { beginTrace, activeTraceFor, completeTrace } = await import("../trace-recorder");
const { useTraceStore } = await import("../trace-store");

// In-memory structured storage so recorder flushes and retention stay pure.
const storageData = new Map<string, TraceRecord>();
vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({
    read: (_entity: string, id: string) => Promise.resolve(storageData.get(id)),
    readAll: () => Promise.resolve([...storageData.values()]),
    write: (_entity: string, id: string, data: TraceRecord) =>
      Promise.resolve(storageData.set(id, data)),
    delete: (_entity: string, id: string) => Promise.resolve(storageData.delete(id)),
    deleteMany: (_entity: string, ids: string[]) =>
      Promise.resolve(ids.forEach((id) => storageData.delete(id))),
  }),
}));

// Deterministic monotonic clock.
let now = 1_000;
const advance = (ms: number) => {
  now += ms;
};

beforeEach(() => {
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  storageData.clear();
  useTraceStore.setState({ traces: {}, traceIdByMessage: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("TraceRecorder", () => {
  it("records chunk timing: seq, gap stats, ttfb and tokens/s", () => {
    const trace = beginTrace("conversation-1", { providerId: "p1", modelId: "m1", mode: "ask" });
    advance(120);
    trace.recordDelta("text", 10); // ttfb = 120
    advance(30);
    trace.recordDelta("text", 20); // gap 30
    advance(70);
    trace.recordDelta("text", 30); // gap 70
    trace.recordUsage(100); // outputTokens
    trace.attachMessages(["message-1"]);
    completeTrace("conversation-1", "completed");

    const snapshot = trace.snapshot();
    expect(snapshot.metrics.ttfbMs).toBe(120);
    expect(snapshot.metrics.chunkCount).toBe(3);
    expect(snapshot.metrics.avgGapMs).toBe(50); // (30+70)/2
    expect(snapshot.metrics.maxGapMs).toBe(70);
    expect(snapshot.metrics.p95GapMs).toBe(70);
    expect(snapshot.metrics.outputTokens).toBe(100);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.messageIds).toEqual(["message-1"]);

    // Correlation (§20): one trace id binds conversation + messages.
    const events = snapshot.events;
    expect(events[0]?.kind).toBe("turn.started");
    expect(events.some((event) => event.kind === "first-token")).toBe(true);
    expect(events.at(-1)?.kind).toBe("turn.completed");
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.seq).toBe(events[index - 1]!.seq + 1);
    }
  });

  it("caps stored delta events while aggregate stats keep counting (§27/§28)", () => {
    const trace = beginTrace("conversation-1");
    for (let index = 0; index < MAX_STORED_DELTA_EVENTS + 300; index += 1) {
      advance(2);
      trace.recordDelta("text", 5);
    }
    const snapshot = trace.snapshot();
    expect(snapshot.metrics.chunkCount).toBe(MAX_STORED_DELTA_EVENTS + 300);
    const deltaEvents = snapshot.events.filter((event) => event.kind === "stream.delta");
    expect(deltaEvents.length).toBeLessThanOrEqual(MAX_STORED_DELTA_EVENTS);
    // Original per-event timing is preserved, never re-timestamped.
    expect(deltaEvents[0]?.deltaMs).toBeGreaterThanOrEqual(0);
  });

  it("tracks tool duration and failures with error categories (§25)", () => {
    const trace = beginTrace("conversation-1");
    advance(50);
    trace.toolStarted("call-1", "read_file");
    advance(220);
    trace.toolSettled("call-1", { success: true, durationMs: 220 });
    trace.toolStarted("call-2", "write_file");
    advance(90);
    trace.toolSettled("call-2", {
      success: false,
      durationMs: 90,
      errorCategory: "permission_denied",
    });
    completeTrace("conversation-1", "failed");

    const snapshot = trace.snapshot();
    const tools = Object.fromEntries(snapshot.tools.map((tool) => [tool.toolCallId, tool]));
    expect(tools["call-1"]?.status).toBe("ok");
    expect(tools["call-1"]?.durationMs).toBe(220);
    expect(tools["call-2"]?.status).toBe("error");
    expect(tools["call-2"]?.errorCategory).toBe("permission_denied");
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: "tool.completed", toolCallId: "call-1", durationMs: 220 }),
    );
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: "tool.failed", status: "error", toolCallId: "call-2" }),
    );
  });

  it("measures approval wait between requested and resolved (§24)", () => {
    const trace = beginTrace("conversation-1");
    advance(100);
    trace.approvalRequested("call-1", "run_command");
    advance(1_500);
    trace.approvalResolved("granted", "call-1");

    const snapshot = trace.snapshot();
    expect(snapshot.metrics.approvalWaitMs).toBeGreaterThanOrEqual(1_400);
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: "approval.requested", toolCallId: "call-1" }),
    );
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ kind: "approval.granted", toolCallId: "call-1" }),
    );
  });

  it("never carries content or hidden reasoning — metadata only (§23/§26)", () => {
    const trace = beginTrace("conversation-1");
    trace.recordDelta("text", 42);
    trace.toolStarted("call-1", "read_file");
    trace.toolSettled("call-1", {
      success: true,
      durationMs: 10,
      inputSummary: "args: path",
      outputSummary: "128 chars · 3 lines",
    });
    completeTrace("conversation-1", "completed");

    const allowedKeys = new Set([
      "seq",
      "at",
      "receivedAt",
      "deltaMs",
      "kind",
      "status",
      "toolCallId",
      "browserSessionId",
      "summary",
      "size",
      "durationMs",
    ]);
    const snapshotJson = JSON.stringify(trace.snapshot());
    for (const event of trace.snapshot().events) {
      for (const key of Object.keys(event)) expect(allowedKeys.has(key)).toBe(true);
    }
    // Reasoning kinds exist ONLY when a provider explicitly returns them; the
    // recorder cannot invent them, and none were recorded here.
    expect(snapshotJson).not.toContain("reasoning");
    expect(snapshotJson).not.toContain("chain");
  });

  it("finalizes once; later events are ignored and the snapshot validates", () => {
    const trace = beginTrace("conversation-1");
    completeTrace("conversation-1", "stopped");
    const eventsAfterFinalize = trace.snapshot().events.length;
    trace.record("usage");
    completeTrace("conversation-1", "completed");
    expect(trace.snapshot().events.length).toBe(eventsAfterFinalize);
    expect(trace.snapshot().status).toBe("stopped");

    const parsed = traceRecordSchema.safeParse(trace.snapshot());
    expect(parsed.success).toBe(true);
  });

  it("is keyed per conversation and a new turn retires the stale recorder", () => {
    beginTrace("conversation-1");
    expect(activeTraceFor("conversation-1")).toBeDefined();
    completeTrace("conversation-1", "completed");
    expect(activeTraceFor("conversation-1")).toBeUndefined();

    beginTrace("conversation-1");
    const stale = activeTraceFor("conversation-1");
    beginTrace("conversation-1"); // supersedes the running one
    expect(stale?.snapshot().status).toBe("stopped");
  });
});

describe("trace store retention (§27)", () => {
  it("prunes expired, dead-running and over-cap traces", async () => {
    const day = 24 * 60 * 60 * 1000;
    const make = (
      id: string,
      startedAtDaysAgo: number,
      status: TraceRecord["status"],
    ): TraceRecord => ({
      id,
      version: 1,
      conversationId: "conversation-1",
      messageIds: [`message-${id}`],
      requestIds: [],
      startedAt: Date.now() - startedAtDaysAgo * day,
      status,
      events: [],
      tools: [],
      metrics: {},
    });
    const fresh = make("fresh", 1, "completed");
    const expired = make("expired", TRACE_RETENTION_DAYS + 2, "completed");
    const deadRunning = make("dead-running", 0, "running");
    for (let index = 0; index < TRACE_MAX_RECORDS; index += 1) {
      storageData.set(`bulk-${index}`, make(`bulk-${index}`, 3, "completed"));
    }
    storageData.set("fresh", fresh);
    storageData.set("expired", expired);
    storageData.set("dead-running", deadRunning);

    await useTraceStore.getState().cleanupRetention();

    const remaining = [...storageData.keys()];
    expect(remaining).toContain("fresh");
    expect(remaining).not.toContain("expired");
    expect(remaining).not.toContain("dead-running");
    expect(remaining.length).toBeLessThanOrEqual(TRACE_MAX_RECORDS);
  });
});
