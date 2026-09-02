import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import packageJson from "../../package.json";
import { DiagnosticExportCancelledError } from "../core/logging/diagnostic-port";
import { logger } from "../core/logging/logger";
import type { DiagnosticExportOptions, LogLevel } from "../core/logging/types";
import { currentPlatform } from "../core/shortcuts/platform";
import { downloadBlob } from "../features/chat/conversation-export";
import { useMcpStore } from "../features/mcp/mcp-store";
import { useProviderStore } from "../features/provider/provider-store";
import { DesktopDiagnosticsExport } from "../runtime/diagnostics-export";
import { getRuntime } from "../runtime/use-runtime";
import { useConfirmationDialog } from "./useConfirmationDialog";

type DiagnosticsFilter = "all" | "info" | "warn" | "error";

const FILTERS: DiagnosticsFilter[] = ["all", "info", "warn", "error"];
const MAX_SHOWN = 50;

const BUNDLE_OPTIONS: DiagnosticExportOptions = {
  includeDays: 7,
  includeCrashReports: false,
  includePerformanceSummary: true,
  includeSelectedConversationIds: [],
  includeRawProtocolCapture: false,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function levelBadgeClass(level: LogLevel): string {
  if (level === "error" || level === "fatal") return "text-red-600 dark:text-red-400";
  if (level === "warn") return "text-amber-600 dark:text-amber-400";
  if (level === "info") return "text-blue-600 dark:text-blue-400";
  return "text-muted";
}

export function DiagnosticsSettings() {
  const { t, i18n } = useTranslation();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [filter, setFilter] = useState<DiagnosticsFilter>("all");
  const [entries, setEntries] = useState(() => logger.getEntries());
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [copiedDirectory, setCopiedDirectory] = useState(false);
  const [evidenceMarker, setEvidenceMarker] = useState<{
    evidenceId: string;
    actionId: string;
    timestamp: string;
  } | null>(null);
  const persistence = logger.persistenceStatus();

  useEffect(() => {
    return logger.subscribe(() => setEntries(logger.getEntries()));
  }, []);

  const visibleEntries = useMemo(() => {
    const matched = filter === "all" ? entries : entries.filter((entry) => entry.level === filter);
    return matched.slice(-MAX_SHOWN).reverse();
  }, [entries, filter]);

  const handleExport = async () => {
    setExportResult(null);
    try {
      const exportedEntries = logger.getEntries();
      const blob = new Blob([logger.exportLogs()], { type: "application/json" });
      const saved = await downloadBlob(blob, `evir-diagnostics-${Date.now()}.json`);
      logger.info(
        "artifact",
        saved ? "diagnostics.export-completed" : "diagnostics.export-cancelled",
        {
          entryCount: exportedEntries.length,
        },
      );
      setExportResult(t(saved ? "diagnostics.exported" : "diagnostics.exportCancelled"));
    } catch (error) {
      logger.error("artifact", "diagnostics.export-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      setExportResult(t("diagnostics.exportFailed"));
    }
  };

  const handleClear = () => {
    logger.clear();
    setEntries(logger.getEntries());
  };

  const handleEvidenceMarker = () => {
    const evidenceId = `ev-${crypto.randomUUID()}`;
    const actionId = logger.latestActionId() ?? `act-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const related = [...logger.getEntries()].reverse().find((entry) => entry.actionId === actionId);
    logger.info("artifact", "evidence.capture", {
      evidenceId,
      actionId,
      ...(related?.conversationId ? { conversationId: related.conversationId } : {}),
      ...(related?.projectId ? { projectId: related.projectId } : {}),
      ...(related?.runId ? { runId: related.runId } : {}),
      ...(related?.planId ? { planId: related.planId } : {}),
      screen: "diagnostics",
      capturedAt: timestamp,
    });
    setEvidenceMarker({ evidenceId, actionId, timestamp });
  };

  const runBundleExport = async (exportPort: DesktopDiagnosticsExport) => {
    try {
      const { zipPath } = await exportPort.generateExport(BUNDLE_OPTIONS);
      logger.info("artifact", "diagnostics.bundle-export-completed", { path: zipPath });
      setExportResult(t("diagnostics.bundleExported", { path: zipPath }));
    } catch (error) {
      if (error instanceof DiagnosticExportCancelledError) {
        logger.info("artifact", "diagnostics.bundle-export-cancelled");
        setExportResult(t("diagnostics.bundleCancelled"));
        return;
      }
      logger.error("artifact", "diagnostics.bundle-export-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      setExportResult(t("diagnostics.bundleExportFailed"));
    }
  };

  const handleBundleExport = () => {
    setExportResult(null);
    const bundleSource = () => ({
      appVersion: packageJson.version,
      platform: currentPlatform(),
      locale: i18n.resolvedLanguage ?? i18n.language,
      target: getRuntime().target,
      capabilities: [...getRuntime().capabilities],
      logPersistence: logger.persistenceStatus(),
      providers: useProviderStore.getState().providers,
      mcpServers: useMcpStore.getState().servers,
      recentLogEvents: logger.getEntries(),
    });
    const exportPort = new DesktopDiagnosticsExport(bundleSource);
    void exportPort
      .previewExport(BUNDLE_OPTIONS)
      .then((preview) => {
        requestConfirmation(
          {
            title: t("diagnostics.bundleConfirmTitle"),
            description: t("diagnostics.bundleConfirmDescription", {
              fileCount: preview.fileCount,
              size: formatBytes(preview.estimatedSize),
            }),
            confirmLabel: t("diagnostics.bundleConfirm"),
          },
          () => void runBundleExport(exportPort),
        );
      })
      .catch((error: unknown) => {
        logger.error("artifact", "diagnostics.bundle-preview-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        setExportResult(t("diagnostics.bundleExportFailed"));
      });
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
          <button type="button" className="secondary-button" onClick={handleEvidenceMarker}>
            {t("diagnostics.createEvidenceMarker")}
          </button>
          {getRuntime().target === "desktop" && (
            <button type="button" className="secondary-button" onClick={handleBundleExport}>
              {t("diagnostics.exportBundle")}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={() => void handleExport()}>
            {t("diagnostics.export")}
          </button>
          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg cursor-pointer text-sm hover:bg-surface-hover transition danger"
            onClick={() =>
              requestConfirmation(
                {
                  title: t("confirmation.clearTitle"),
                  description: t("confirmation.clearDescription", {
                    item: t("diagnostics.data"),
                  }),
                  confirmLabel: t("diagnostics.clear"),
                },
                handleClear,
              )
            }
          >
            {t("diagnostics.clear")}
          </button>
        </div>
      </div>
      {exportResult && (
        <p className="text-sm text-muted" role="status">
          {exportResult}
        </p>
      )}
      {evidenceMarker && (
        <p className="text-sm text-muted" role="status">
          {t("diagnostics.evidenceMarkerCreated", evidenceMarker)}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {persistence.active
            ? t("diagnostics.persistenceActive")
            : t("diagnostics.persistenceMemoryOnly")}
        </p>
        {persistence.active && persistence.directory && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted">{t("diagnostics.logDirectoryLabel")}</span>
            <code className="text-xs">{persistence.directory}</code>
            <button
              type="button"
              className="px-2 py-1 text-xs border border-border rounded-lg cursor-pointer hover:bg-surface-hover transition"
              onClick={() => {
                void navigator.clipboard.writeText(persistence.directory ?? "").then(() => {
                  setCopiedDirectory(true);
                  setTimeout(() => setCopiedDirectory(false), 1500);
                });
              }}
            >
              {copiedDirectory
                ? t("diagnostics.logDirectoryCopied")
                : t("diagnostics.copyLogDirectory")}
            </button>
          </div>
        )}
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
        <ul
          className="flex flex-col gap-1 border border-border rounded-lg max-h-96 overflow-y-auto"
          tabIndex={0}
          aria-label={t("diagnostics.data")}
        >
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
      {confirmationDialog}
    </section>
  );
}
