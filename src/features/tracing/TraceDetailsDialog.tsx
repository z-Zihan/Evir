import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Download } from "lucide-react";
import { copyTextWithFeedback, notify } from "../../components/feedback";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui";
import { downloadBlob } from "../chat/conversation-export";
import type { TraceEventRecord, TraceRecord } from "./trace-types";

/**
 * 运行详情 (§29-31): per-assistant-turn trace view — summary metrics, a
 * timeline of every recorded event with +Δ gaps, tool table and export. Data
 * is metadata-only (timings/kinds/tool names); no conversation content and no
 * hidden reasoning exists in a trace to begin with (§23).
 */

function formatMs(value: number | undefined): string {
  if (value === undefined) return "–";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)}s`;
}

function eventLabel(event: TraceEventRecord, t: (key: string) => string): string {
  const key = `trace.event.${event.kind}`;
  const translated = t(key);
  return translated === key
    ? event.kind
    : `${translated}${event.summary ? ` · ${event.summary}` : ""}`;
}

function summaryLine(trace: TraceRecord, t: (key: string) => string): string {
  const metrics = trace.metrics;
  return [
    `${t("trace.summary.total")}: ${formatMs(metrics.totalDurationMs)}`,
    `${t("trace.summary.ttfb")}: ${formatMs(metrics.ttfbMs)}`,
    `${t("trace.summary.chunks")}: ${metrics.chunkCount ?? 0}`,
    `${t("trace.summary.maxGap")}: ${formatMs(metrics.maxGapMs)}`,
    `${t("trace.summary.tools")}: ${trace.tools.length}`,
    `${t("trace.summary.failures")}: ${trace.tools.filter((tool) => tool.status === "error").length}`,
    `status: ${trace.status}`,
  ].join(" · ");
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-2.5 py-2">
      <span className="text-[10px] font-medium tracking-wide text-muted uppercase">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function TraceDetailsDialog({
  trace,
  onClose,
}: {
  trace: TraceRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const metrics = trace.metrics;
  const failedTools = trace.tools.filter((tool) => tool.status === "error").length;

  const summaryText = useMemo(() => summaryLine(trace, t), [trace, t]);

  const exportJson = async () => {
    const ok = await downloadBlob(
      new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" }),
      `evir-trace-${trace.id}.json`,
    );
    if (!ok) notify.error(t("trace.export.failed"));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("trace.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <MetricCard
              label={t("trace.summary.total")}
              value={formatMs(metrics.totalDurationMs)}
            />
            <MetricCard label={t("trace.summary.ttfb")} value={formatMs(metrics.ttfbMs)} />
            <MetricCard
              label={t("trace.summary.streaming")}
              value={formatMs(metrics.streamingDurationMs)}
            />
            <MetricCard label={t("trace.summary.chunks")} value={String(metrics.chunkCount ?? 0)} />
            <MetricCard label={t("trace.summary.avgGap")} value={formatMs(metrics.avgGapMs)} />
            <MetricCard label={t("trace.summary.maxGap")} value={formatMs(metrics.maxGapMs)} />
            <MetricCard label={t("trace.summary.p95Gap")} value={formatMs(metrics.p95GapMs)} />
            {metrics.tokensPerSecond !== undefined && (
              <MetricCard
                label={t("trace.summary.tps")}
                value={metrics.tokensPerSecond.toFixed(1)}
              />
            )}
          </div>

          {trace.tools.length > 0 && (
            <section aria-label={t("trace.tools.title")} className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                {t("trace.tools.title")}
              </h3>
              <div className="flex flex-col gap-1">
                {trace.tools.map((tool) => (
                  <div
                    key={tool.toolCallId}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{tool.toolName}</span>
                    <span className="shrink-0 text-[11px] text-muted tabular-nums">
                      {formatMs(tool.durationMs)}
                    </span>
                    <Badge variant={tool.status === "ok" ? "success" : "danger"}>
                      {tool.status === "ok"
                        ? t("trace.tools.ok")
                        : tool.status === "running"
                          ? t("trace.tools.running")
                          : t("trace.tools.failed")}
                    </Badge>
                  </div>
                ))}
              </div>
              {failedTools > 0 && (
                <p className="text-[11px] text-muted">
                  {t("trace.summary.failures")}: {failedTools}
                  {metrics.approvalWaitMs !== undefined
                    ? ` · ${t("trace.summary.approvalWait")}: ${formatMs(metrics.approvalWaitMs)}`
                    : ""}
                </p>
              )}
            </section>
          )}

          <section aria-label={t("trace.timeline.title")} className="flex min-h-0 flex-col gap-1.5">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              {t("trace.timeline.title")}
            </h3>
            <div className="trace-timeline flex flex-col gap-px overflow-y-auto rounded-lg border border-border">
              {trace.events.map((event) => (
                <div
                  key={event.seq}
                  className="grid grid-cols-[64px_58px_1fr_54px] items-center gap-2 bg-surface px-2 py-1 text-[11px] tabular-nums"
                  data-trace-event={event.kind}
                >
                  <span className="text-muted">{(event.at / 1000).toFixed(3)}</span>
                  <span className="text-muted">+{formatMs(event.deltaMs)}</span>
                  <span className="min-w-0 truncate text-foreground" title={event.summary}>
                    {eventLabel(event, t)}
                    {event.size !== undefined ? ` (${event.size})` : ""}
                  </span>
                  <span
                    className={
                      event.status === "error"
                        ? "text-right text-danger"
                        : event.status === "cancelled"
                          ? "text-right text-muted"
                          : "text-right text-muted"
                    }
                  >
                    {event.durationMs !== undefined && event.durationMs > 0
                      ? formatMs(event.durationMs)
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void copyTextWithFeedback(summaryText, { successKey: "trace.export.copied" })
            }
          >
            <Copy size={13} />
            {t("trace.export.copySummary")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void exportJson()}>
            <Download size={13} />
            {t("trace.export.json")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TraceDetailsDialog;
