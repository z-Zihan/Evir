import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  Flame,
  Gauge,
  Layers3,
  MessageSquareText,
  Trash2,
} from "lucide-react";
import { db } from "../core/storage/db";
import { useUsageStore } from "../features/usage/usage-store";
import {
  buildUsageAnalytics,
  buildUsageSeries,
  type UsagePoint,
  type UsageRange,
} from "./usage-analytics";
import { useConfirmationDialog } from "./useConfirmationDialog";

function compactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

function UsageChart({
  points,
  range,
  locale,
}: {
  points: UsagePoint[];
  range: UsageRange;
  locale: string;
}) {
  const maximum = Math.max(1, ...points.map(({ tokens }) => tokens));
  const width = 720;
  const height = 190;
  const baseline = 154;
  const plotHeight = 126;
  const step = width / points.length;
  const linePoints = points
    .map(
      ({ tokens }, index) =>
        `${index * step + step / 2},${baseline - (tokens / maximum) * plotHeight}`,
    )
    .join(" ");
  const labelIndexes = new Set([0, 7, 14, 21, points.length - 1]);

  return (
    <div className="usage-chart-wrap">
      <svg
        className="usage-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Token usage trend"
      >
        {[0, 1, 2, 3].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={baseline - line * 42}
            y2={baseline - line * 42}
            className="usage-grid-line"
          />
        ))}
        {range === "cumulative" ? (
          <>
            <polyline points={linePoints} className="usage-line-halo" />
            <polyline points={linePoints} className="usage-line" />
          </>
        ) : (
          points.map((point, index) => {
            const barHeight = Math.max(
              point.tokens > 0 ? 3 : 0,
              (point.tokens / maximum) * plotHeight,
            );
            return (
              <rect
                key={point.key}
                x={index * step + step * 0.18}
                y={baseline - barHeight}
                width={Math.max(2, step * 0.64)}
                height={barHeight}
                rx="2"
                className="usage-bar"
              >
                <title>{`${point.label}: ${compactNumber(point.tokens, locale)} tokens · ${point.requests}`}</title>
              </rect>
            );
          })
        )}
        {points.map((point, index) =>
          labelIndexes.has(index) ? (
            <text
              key={point.key}
              x={index * step + step / 2}
              y="181"
              textAnchor="middle"
              className="usage-axis-label"
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function UsagePanel() {
  const { t, i18n } = useTranslation();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const { records, loadRecords } = useUsageStore();
  const [range, setRange] = useState<UsageRange>("daily");
  const [isClearing, setIsClearing] = useState(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const analytics = useMemo(() => buildUsageAnalytics(records), [records]);
  const series = useMemo(() => buildUsageSeries(records, range, locale), [records, range, locale]);
  const maximumModelTokens = Math.max(1, ...analytics.models.map(({ tokens }) => tokens));
  const months = Array.from({ length: 13 }, (_, index) => {
    const position = Math.min(364, index * 30);
    const timestamp = analytics.heatmap[position]?.timestamp ?? Date.now();
    return {
      label: new Intl.DateTimeFormat(locale, { month: "short" }).format(timestamp),
      position: (position / 364) * 100,
    };
  });

  const clearRecords = async () => {
    setIsClearing(true);
    try {
      await db.usage_records.clear();
      await loadRecords();
    } finally {
      setIsClearing(false);
    }
  };

  const metrics = [
    {
      label: t("usage.totalTokens"),
      value: compactNumber(analytics.totalTokens, locale),
      icon: Layers3,
    },
    {
      label: t("usage.peakDay"),
      value: compactNumber(analytics.peakDayTokens, locale),
      icon: Flame,
    },
    {
      label: t("usage.peakRequest"),
      value: compactNumber(analytics.peakRequestTokens, locale),
      icon: Gauge,
    },
    {
      label: t("usage.activeDays"),
      value: compactNumber(analytics.activeDays, locale),
      icon: CalendarDays,
    },
    {
      label: t("usage.currentStreak"),
      value: t("usage.days", { count: analytics.currentStreak }),
      icon: Activity,
    },
  ];

  return (
    <section className="usage-dashboard">
      <div className="settings-page-intro">
        <div>
          <span className="settings-page-eyebrow">{t("usage.insights")}</span>
          <p>{t("usage.description")}</p>
        </div>
        <button
          className="quiet-danger-button"
          type="button"
          onClick={() =>
            requestConfirmation(
              {
                title: t("confirmation.clearTitle"),
                description: t("confirmation.clearDescription", { item: t("usage.data") }),
                confirmLabel: t("usage.clear"),
              },
              clearRecords,
            )
          }
          disabled={isClearing || records.length === 0}
        >
          <Trash2 size={14} />
          {t("usage.clear")}
        </button>
      </div>

      <div className="usage-metrics">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div className="usage-metric" key={label}>
            <Icon size={14} aria-hidden="true" />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <section className="settings-section-card usage-activity-card">
        <div className="settings-card-heading">
          <div>
            <h4>{t("usage.activity")}</h4>
            <p>{t("usage.activityDescription")}</p>
          </div>
          <div className="segmented-control" role="group" aria-label={t("usage.range")}>
            {(["daily", "weekly", "cumulative"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={range === value ? "active" : ""}
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {t(`usage.${value}`)}
              </button>
            ))}
          </div>
        </div>
        {records.length === 0 ? (
          <div className="usage-empty">{t("usage.noData")}</div>
        ) : (
          <UsageChart points={series} range={range} locale={locale} />
        )}
      </section>

      <section className="settings-section-card heatmap-card">
        <div className="settings-card-heading">
          <div>
            <h4>{t("usage.yearActivity")}</h4>
            <p>{t("usage.yearActivityDescription")}</p>
          </div>
          <span className="usage-streak-note">
            {t("usage.longestStreak", { count: analytics.longestStreak })}
          </span>
        </div>
        <div className="usage-heatmap-scroll">
          <div className="usage-months">
            {months.map((month, index) => (
              <span key={`${month.label}-${index}`} style={{ left: `${month.position}%` }}>
                {month.label}
              </span>
            ))}
          </div>
          <div className="usage-heatmap" aria-label={t("usage.yearActivity")}>
            {analytics.heatmap.map((day) => (
              <span key={day.key} className={`usage-day level-${day.level}`}>
                <span className="sr-only">{`${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(day.timestamp)}: ${day.tokens} tokens`}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section-card models-card">
        <div className="settings-card-heading">
          <div>
            <h4>{t("usage.byModel")}</h4>
            <p>{t("usage.byModelDescription")}</p>
          </div>
          <span className="usage-streak-note">
            {t("usage.modelCount", { count: analytics.models.length })}
          </span>
        </div>
        {analytics.models.length === 0 ? (
          <div className="usage-empty">{t("usage.noData")}</div>
        ) : (
          <div className="model-usage-list">
            {analytics.models.map((model) => (
              <div className="model-usage-row" key={model.modelId}>
                <div className="model-usage-name">
                  <span className="model-signal" aria-hidden="true" />
                  <strong>{model.modelId}</strong>
                  <span>
                    <MessageSquareText size={12} />
                    {t("usage.requests", { count: model.requests })}
                  </span>
                </div>
                <div className="model-usage-bar">
                  <span style={{ transform: `scaleX(${model.tokens / maximumModelTokens})` }} />
                </div>
                <div className="model-usage-values">
                  <strong>{compactNumber(model.tokens, locale)}</strong>
                  <span>
                    <ArrowDownToLine size={11} />
                    {compactNumber(model.inputTokens, locale)}
                  </span>
                  <span>
                    <ArrowUpFromLine size={11} />
                    {compactNumber(model.outputTokens, locale)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {confirmationDialog}
    </section>
  );
}
