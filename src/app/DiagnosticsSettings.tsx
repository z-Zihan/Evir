import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { logger } from "../core/logging/logger";
import type { LogLevel } from "../core/logging/types";
import { downloadBlob } from "../features/chat/conversation-export";

type DiagnosticsFilter = "all" | "info" | "warn" | "error";

const FILTERS: DiagnosticsFilter[] = ["all", "info", "warn", "error"];
const MAX_SHOWN = 50;

function levelBadgeClass(level: LogLevel): string {
  if (level === "error" || level === "fatal") return "text-red-600 dark:text-red-400";
  if (level === "warn") return "text-amber-600 dark:text-amber-400";
  if (level === "info") return "text-blue-600 dark:text-blue-400";
  return "text-muted";
}

export function DiagnosticsSettings() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<DiagnosticsFilter>("all");
  const [entries, setEntries] = useState(() => logger.getEntries());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setEntries(logger.getEntries());
    }, 2000);
    return () => clearInterval(intervalId);
  }, []);

  const visibleEntries = useMemo(() => {
    const matched = filter === "all" ? entries : entries.filter((entry) => entry.level === filter);
    return matched.slice(-MAX_SHOWN).reverse();
  }, [entries, filter]);

  const handleExport = () => {
    const blob = new Blob([logger.exportLogs()], { type: "application/json" });
    downloadBlob(blob, `evir-diagnostics-${Date.now()}.json`);
  };

  const handleClear = () => {
    logger.clear();
    setEntries(logger.getEntries());
  };

  return (
    <section className="diagnostics-settings settings-designed-page">
      <div className="settings-page-intro compact">
        <div>
          <span className="settings-page-eyebrow">
            {t("settingsDescriptions.localDiagnostics")}
          </span>
          <p>{t("settingsDescriptions.diagnostics")}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="secondary-button" onClick={handleExport}>
            {t("diagnostics.export")}
          </button>
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
            onClick={handleClear}
          >
            {t("diagnostics.clear")}
          </button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap" role="group" aria-label={t("diagnostics.filter")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`px-3 py-1.5 rounded-lg text-sm border border-border transition${
              filter === f
                ? " bg-surface-hover text-foreground"
                : " text-muted hover:bg-surface-hover hover:text-foreground"
            }`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`diagnostics.filters.${f}`)}
          </button>
        ))}
      </div>
      {visibleEntries.length === 0 ? (
        <p className="text-sm text-muted p-4">{t("diagnostics.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1 border border-border rounded-lg max-h-96 overflow-y-auto">
          {visibleEntries.map((entry, index) => (
            <li
              key={`${entry.sessionId}-${entry.timestamp}-${index}`}
              className="flex items-baseline gap-2 px-3 py-2 text-sm border-b border-border last:border-b-0"
            >
              <span className="text-xs text-muted shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`text-xs uppercase font-medium shrink-0 ${levelBadgeClass(entry.level)}`}
              >
                {t(`diagnostics.levels.${entry.level}`)}
              </span>
              <span className="text-xs text-muted shrink-0">{entry.channel}</span>
              <span className="text-foreground truncate">{entry.message ?? entry.event}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
