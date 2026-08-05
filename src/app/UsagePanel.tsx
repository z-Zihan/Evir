import { useState } from "react";
import { useTranslation } from "react-i18next";
import { db, type UsageRecord } from "../core/storage/db";
import { useUsageStore } from "../features/usage/usage-store";

function formatRelativeTime(timestamp: number, locale: string): string {
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  const elapsedDays = Math.round(elapsedHours / 24);
  if (Math.abs(elapsedDays) < 30) return formatter.format(elapsedDays, "day");
  const elapsedMonths = Math.round(elapsedDays / 30);
  if (Math.abs(elapsedMonths) < 12) return formatter.format(elapsedMonths, "month");
  return formatter.format(Math.round(elapsedMonths / 12), "year");
}

function tokenCount(value: number | undefined, locale: string): string {
  return value === undefined ? "—" : value.toLocaleString(locale);
}

function duration(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "millisecond",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(value);
}

function EvidenceBadge({ evidence }: Pick<UsageRecord, "evidence">) {
  const { t } = useTranslation();
  return <span className={`usage-evidence ${evidence}`}>{t(`usage.${evidence}`)}</span>;
}

export function UsagePanel() {
  const { t, i18n } = useTranslation();
  const { records, loadRecords, getTotalTokens } = useUsageStore();
  const [isClearing, setIsClearing] = useState(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const firstTokenRecords = records.filter(({ firstTokenMs }) => firstTokenMs !== undefined);
  const averageLatency = firstTokenRecords.length
    ? firstTokenRecords.reduce((total, record) => total + (record.firstTokenMs ?? 0), 0) /
      firstTokenRecords.length
    : undefined;
  const successRate = records.length
    ? records.filter(({ success }) => success).length / records.length
    : 0;

  const clearRecords = async () => {
    setIsClearing(true);
    try {
      await db.usage_records.clear();
      await loadRecords();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <section className="usage-panel">
      <div className="usage-heading">
        <h3>{t("usage.title")}</h3>
        <button type="button" onClick={() => void clearRecords()} disabled={isClearing}>
          {t("usage.clear")}
        </button>
      </div>
      <div className="usage-summary">
        <div>
          <span>{t("usage.totalTokens")}</span>
          <strong>{getTotalTokens().toLocaleString(locale)}</strong>
        </div>
        <div>
          <span>{t("usage.totalRequests")}</span>
          <strong>{records.length.toLocaleString(locale)}</strong>
        </div>
        <div>
          <span>{t("usage.successRate")}</span>
          <strong>
            {successRate.toLocaleString(locale, { style: "percent", maximumFractionDigits: 1 })}
          </strong>
        </div>
        <div>
          <span>{t("usage.avgLatency")}</span>
          <strong>{averageLatency === undefined ? "—" : duration(averageLatency, locale)}</strong>
        </div>
      </div>
      <h4>{t("usage.recentRecords")}</h4>
      {records.length === 0 ? (
        <div className="usage-empty">{t("usage.noData")}</div>
      ) : (
        <div className="usage-table-wrap">
          <table className="usage-table">
            <thead>
              <tr>
                <th>{t("usage.model")}</th>
                <th>{t("usage.input")}</th>
                <th>{t("usage.output")}</th>
                <th>{t("usage.status")}</th>
                <th>{t("usage.duration")}</th>
                <th>{t("usage.time")}</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 20).map((record) => (
                <tr key={record.id}>
                  <td>
                    <span className="usage-model">{record.modelId}</span>
                    <EvidenceBadge evidence={record.evidence} />
                  </td>
                  <td>{tokenCount(record.inputTokens, locale)}</td>
                  <td>{tokenCount(record.outputTokens, locale)}</td>
                  <td className={record.success ? "usage-success" : "usage-failed"}>
                    {t(record.success ? "usage.success" : "usage.failed")}
                  </td>
                  <td>{duration(record.durationMs, locale)}</td>
                  <td>{formatRelativeTime(record.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
