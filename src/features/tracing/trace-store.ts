import { create } from "zustand";
import {
  TRACE_MAX_RECORDS,
  TRACE_RETENTION_DAYS,
  traceRecordSchema,
  type TraceRecord,
} from "./trace-types";
import { getStructuredStorage } from "../../runtime/structured-storage";

/**
 * Reactive view over traces (§29-30): assistant rows look up "运行详情" by
 * messageId; the conversation view loads persisted traces when a conversation
 * opens. Retention (§27) prunes by age and count on load.
 */

interface TraceState {
  /** Loaded/known traces by traceId. */
  traces: Record<string, TraceRecord>;
  /** messageId -> traceId for rows that belong to a traced turn. */
  traceIdByMessage: Record<string, string>;
  upsertTrace: (trace: TraceRecord) => void;
  loadForConversation: (conversationId: string) => Promise<void>;
  cleanupRetention: () => Promise<void>;
  traceForMessage: (messageId: string) => TraceRecord | undefined;
}

export const useTraceStore = create<TraceState>((set, get) => ({
  traces: {},
  traceIdByMessage: {},
  upsertTrace: (trace) => {
    set((state) => ({
      traces: { ...state.traces, [trace.id]: trace },
      traceIdByMessage: {
        ...state.traceIdByMessage,
        ...Object.fromEntries(trace.messageIds.map((messageId) => [messageId, trace.id])),
      },
    }));
  },
  loadForConversation: async (conversationId) => {
    try {
      const records = await getStructuredStorage().readAll<TraceRecord>("traces");
      const relevant = records.filter((record) => record.conversationId === conversationId);
      const parsed = relevant.flatMap((record) => {
        const result = traceRecordSchema.safeParse(record);
        return result.success ? [result.data] : [];
      });
      const traces = { ...get().traces };
      const traceIdByMessage = { ...get().traceIdByMessage };
      for (const trace of parsed) {
        traces[trace.id] = trace;
        for (const messageId of trace.messageIds) traceIdByMessage[messageId] = trace.id;
      }
      set({ traces, traceIdByMessage });
    } catch {
      // Loading history traces is best-effort; live traces still render.
    }
  },
  cleanupRetention: async () => {
    try {
      const storage = getStructuredStorage();
      const records = await storage.readAll<TraceRecord>("traces");
      const cutoff = Date.now() - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const sorted = [...records].sort((a, b) => b.startedAt - a.startedAt);
      const expired = new Set(
        sorted
          .filter((record) => record.startedAt < cutoff || record.status === "running")
          .map((record) => record.id),
      );
      // "running" traces from a previous session are dead turns, not live ones.
      sorted.slice(TRACE_MAX_RECORDS).forEach((record) => expired.add(record.id));
      if (expired.size === 0) return;
      await storage.deleteMany("traces", [...expired]);
      set((state) => {
        const traces = { ...state.traces };
        const traceIdByMessage = { ...state.traceIdByMessage };
        for (const id of expired) {
          const trace = traces[id];
          delete traces[id];
          if (trace) for (const messageId of trace.messageIds) delete traceIdByMessage[messageId];
        }
        return { traces, traceIdByMessage };
      });
    } catch {
      // Retention is background hygiene.
    }
  },
  traceForMessage: (messageId) => {
    const traceId = get().traceIdByMessage[messageId];
    return traceId ? get().traces[traceId] : undefined;
  },
}));

/** Selector hook: the trace behind one assistant message, if any. */
export function useTraceForMessage(messageId: string): TraceRecord | undefined {
  return useTraceStore((state) => {
    const traceId = state.traceIdByMessage[messageId];
    return traceId ? state.traces[traceId] : undefined;
  });
}
