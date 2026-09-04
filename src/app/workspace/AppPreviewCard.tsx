import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  ExternalLink,
  LoaderCircle,
  MonitorPlay,
  Play,
  RotateCw,
  Square,
  Globe,
} from "lucide-react";
import { Button, Tip } from "../../components/ui";
import { copyTextWithFeedback } from "../../components/feedback";
import { openExternal } from "../../features/browser/workbench-service";
import { logger } from "../../core/logging/logger";
import { useConfirmationDialog } from "../useConfirmationDialog";
import { appPreviewStatus, openUrlInPanelBrowser, type DevServerUiController } from "./use-dev-server-ui";
import type { ProjectRecord } from "../../core/storage/db";

/**
 * App Preview control card (§15): one shared surface for the Preview tab entry
 * and the Browser tab status row. Status is always visible (Idle / Starting /
 * Ready / Error / Stopped); Ready shows the URL + last start time and the full
 * control set — Start / Stop / Restart / Open in Browser / Open External /
 * Copy URL / View Logs. Dev-server facts come from the Rust lifecycle service
 * (single source of truth); this card only mirrors and dispatches.
 */
export function AppPreviewCard({
  controller,
  project,
  variant = "full",
}: {
  controller: DevServerUiController;
  project: ProjectRecord | undefined;
  variant?: "full" | "compact";
}) {
  const { t } = useTranslation();
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [logsOpen, setLogsOpen] = useState(false);

  const status = appPreviewStatus(controller.server, controller.starting);
  const url = status === "ready" ? controller.server?.url : null;
  const lastOutput = controller.server?.lastOutput ?? [];
  const startedAt = controller.server?.startedAt;

  // Starting a dev server runs a project script: ask-profile projects confirm
  // first with the exact command line (§44 consent).
  const beginStart = () => {
    logger.info("ui", "ui.app-preview.start", { actionId: crypto.randomUUID(), projectId: project?.id });
    if (!project) return;
    if (project.permissionProfile === "ask") {
      requestConfirmation(
        {
          title: t("workspace.previewApp.confirmTitle"),
          description: t("workspace.previewApp.confirmDescription"),
          confirmLabel: t("workspace.previewApp.start"),
          tone: "warning",
        },
        () => void controller.start(),
      );
      return;
    }
    void controller.start();
  };

  const statusLabel = t(`workspace.previewApp.status.${status}`);
  const dotClass =
    status === "ready"
      ? "bg-success"
      : status === "starting"
        ? "bg-warning animate-pulse"
        : status === "error"
          ? "bg-danger"
          : "bg-muted-foreground/40";

  const actions = (
    <>
      {status === "idle" || status === "stopped" || status === "error" ? (
        controller.plan && (
          <Button variant={variant === "full" ? "primary" : "secondary"} size={variant === "full" ? "lg" : "sm"} disabled={controller.starting} onClick={beginStart}>
            {controller.starting ? (
              <LoaderCircle size={13} className="spin" aria-hidden="true" />
            ) : (
              <Play size={13} aria-hidden="true" />
            )}
            {controller.starting
              ? t("workspace.previewApp.starting")
              : status === "error"
                ? t("workspace.devServer.retry")
                : t("workspace.previewApp.start")}
          </Button>
        )
      ) : (
        <>
          <Button variant="secondary" size={variant === "full" ? "lg" : "sm"} onClick={() => void controller.stop()}>
            <Square size={12} aria-hidden="true" />
            {t("workspace.devServer.stop")}
          </Button>
          <Tip content={t("workspace.previewApp.restart")} side="top">
            <Button
              variant="secondary"
              size={variant === "full" ? "lg" : "sm"}
              disabled={controller.starting}
              onClick={() => void controller.restart()}
            >
              <RotateCw size={12} aria-hidden="true" />
              {variant === "full" ? t("workspace.previewApp.restart") : null}
            </Button>
          </Tip>
        </>
      )}
      {url && (
        <>
          <Tip content={t("workspace.previewApp.openInBrowser")} side="top">
            <Button
              variant="secondary"
              size={variant === "full" ? "lg" : "sm"}
              onClick={() => {
                logger.info("ui", "ui.app-preview.open-browser", { actionId: crypto.randomUUID() });
                void openUrlInPanelBrowser(url).catch(() => undefined);
              }}
            >
              <Globe size={12} aria-hidden="true" />
              {variant === "full" ? t("workspace.previewApp.openInBrowser") : null}
            </Button>
          </Tip>
          <Tip content={t("browser.openExternal")} side="top">
            <Button
              variant="secondary"
              size={variant === "full" ? "lg" : "sm"}
              aria-label={t("browser.openExternal")}
              onClick={() => void openExternal(url).catch(() => undefined)}
            >
              <ExternalLink size={12} aria-hidden="true" />
            </Button>
          </Tip>
          <Tip content={t("workspace.copyUrl")} side="top">
            <Button
              variant="secondary"
              size={variant === "full" ? "lg" : "sm"}
              aria-label={t("workspace.copyUrl")}
              onClick={() => void copyTextWithFeedback(url, { successKey: "workspace.urlCopied" })}
            >
              <Copy size={12} aria-hidden="true" />
            </Button>
          </Tip>
        </>
      )}
      {lastOutput.length > 0 && (
        <Button
          variant="ghost"
          size={variant === "full" ? "lg" : "sm"}
          aria-expanded={logsOpen}
          onClick={() => setLogsOpen((open) => !open)}
        >
          {t("workspace.devServer.viewLogs")}
        </Button>
      )}
    </>
  );

  if (variant === "compact") {
    return (
      <div className="app-preview-compact flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`app-preview-dot inline-block size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
          <span className="text-[11.5px] font-medium text-foreground">{statusLabel}</span>
          {url && (
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate text-[11px] text-primary hover:underline"
              onClick={() => void openUrlInPanelBrowser(url).catch(() => undefined)}
              title={url}
            >
              {url}
            </button>
          )}
          <span className="ml-auto flex items-center gap-1">{actions}</span>
        </div>
        {logsOpen && (
          <pre className="app-preview-logs max-h-32 overflow-y-auto rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted">
            {lastOutput.slice(-30).join("\n")}
          </pre>
        )}
        {confirmationDialog}
      </div>
    );
  }

  const failure = controller.failure;
  const crashed = status === "error";
  const failureCommand = controller.server
    ? `${controller.server.program} ${controller.server.args.join(" ")}`
    : null;

  return (
    <section className="workspace-preview-empty-block app-preview-card">
      <MonitorPlay size={20} aria-hidden="true" />
      <div className="app-preview-copy">
        <h3>{t("workspace.previewApp.title")}</h3>
        <p className="app-preview-state">
          <span className={`app-preview-dot inline-block size-2 rounded-full ${dotClass}`} aria-hidden="true" />{" "}
          {statusLabel}
          {url ? ` · ${url}` : ""}
          {startedAt && status !== "idle"
            ? ` · ${t("workspace.previewApp.lastStarted", {
                time: new Date(startedAt).toLocaleTimeString(),
              })}`
            : ""}
        </p>
        {status === "idle" &&
          (controller.plan ? (
            <p className="app-preview-state">
              {t("workspace.previewApp.detected", {
                script: `${controller.plan.program} ${controller.plan.args.join(" ")}`,
              })}
            </p>
          ) : (
            <p className="app-preview-state">{t("workspace.previewApp.noScript")}</p>
          ))}
        {failure && <p className="app-preview-failure">{failure}</p>}
        {crashed && failureCommand && (
          <div className="app-preview-failure-detail">
            <p>
              {t("workspace.devServer.command")}: <code>{failureCommand}</code>
            </p>
            {controller.server?.exitCode !== null && controller.server?.exitCode !== undefined && (
              <p>
                {t("workspace.devServer.exitCode")}: <code>{controller.server.exitCode}</code>
              </p>
            )}
          </div>
        )}
        {logsOpen && (
          <pre className="app-preview-logs max-h-40 overflow-y-auto rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted">
            {lastOutput.slice(-30).join("\n")}
          </pre>
        )}
      </div>
      <div className="app-preview-actions">{actions}</div>
      {confirmationDialog}
    </section>
  );
}
