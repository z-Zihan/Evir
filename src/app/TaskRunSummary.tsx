import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash2, ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OrchestrationSnapshot } from "../core/orchestration/types";
import { useRunWorkspaceStore } from "../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../features/workspace/workspace-bridge";
import { logger } from "../core/logging/logger";
import { TaskSectionCaption, TaskSectionHeading, TaskSectionTitle } from "../components/ai";
import { cn } from "../components/ui/utils";

type FinishedStatus = "completed" | "partial" | "failed" | "cancelled";

export function TaskRunSummary({
  snapshot,
  statusOverride,
}: {
  snapshot: OrchestrationSnapshot;
  statusOverride?: FinishedStatus | undefined;
}) {
  const { t } = useTranslation();
  const plan = snapshot.plan;
  const outputsCount = useRunWorkspaceStore((state) => state.outputs.length);
  const changes = useRunWorkspaceStore((state) => state.changes);
  const root = useActiveWorkspaceRoot();
  // §14 Result Summary actions: surface the run's deliverables (Outputs) and
  // the touched work files (Changes, with +adds −dels) as first-class entries.
  const [changeTotals, setChangeTotals] = useState<{
    files: number;
    additions: number;
    deletions: number;
  } | null>(null);
  useEffect(() => {
    if (snapshot.phase !== "finished" || changes.length === 0) {
      setChangeTotals(null);
      return;
    }
    let cancelled = false;
    void import("../features/workspace/workspace-services")
      .then(({ summarizeRunChanges }) => summarizeRunChanges({ id: snapshot.runId }, changes, root))
      .then((summary) => {
        if (!cancelled) setChangeTotals(summary);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.phase, snapshot.runId, changes, root]);

  if (!plan || snapshot.phase !== "finished") return null;

  const openOutputs = () => {
    logger.info("ui", "ui.output.open", {
      actionId: crypto.randomUUID(),
      runId: snapshot.runId,
      resourceId: "task-outputs",
    });
    useWorkspacePanelStore.getState().openPanel("outputs");
  };
  const reviewChanges = () => {
    useWorkspacePanelStore.getState().openPanel("changes");
  };

  const completed = plan.nodes.filter(({ status }) => status === "completed");
  const unresolved = plan.nodes.filter(({ status }) =>
    ["failed", "blocked", "cancelled"].includes(status),
  );
  const skipped = plan.nodes.filter(({ status }) => status === "skipped");
  const evidence = snapshot.events.filter(({ type }) => type === "verification.completed");
  const status = statusOverride ?? plan.status;
  const successful = status === "completed";

  return (
    <section
      className={cn("task-run-summary flex flex-col gap-2 border-t border-border px-3.5 py-3")}
      aria-labelledby="task-run-summary-title"
    >
      <TaskSectionHeading className="p-0">
        {successful ? (
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
        ) : (
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
        )}
        <div>
          <TaskSectionTitle id="task-run-summary-title">
            {t("orchestration.summary.title")}
          </TaskSectionTitle>
          <TaskSectionCaption>{t(`orchestration.summary.status.${status}`)}</TaskSectionCaption>
        </div>
      </TaskSectionHeading>
      <p className="task-summary-result m-0 text-[12.5px] leading-relaxed text-foreground/90">
        {snapshot.brief.objective}
      </p>

      <dl className="task-summary-counts m-0 flex gap-4">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[11.5px] text-muted">{t("orchestration.summary.completed")}</dt>
          <dd className="m-0 text-[13px] font-semibold text-foreground">{completed.length}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[11.5px] text-muted">{t("orchestration.summary.unresolved")}</dt>
          <dd className="m-0 text-[13px] font-semibold text-foreground">{unresolved.length}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-[11.5px] text-muted">{t("orchestration.summary.skipped")}</dt>
          <dd className="m-0 text-[13px] font-semibold text-foreground">{skipped.length}</dd>
        </div>
      </dl>

      {snapshot.brief.assumptions.length > 0 && (
        <div className="task-summary-section flex flex-col gap-1">
          <strong className="text-[11.5px] font-semibold">{t("orchestration.assumptions")}</strong>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
            {snapshot.brief.assumptions.map((assumption) => (
              <li key={assumption.id} className="text-[11.5px] text-muted">
                {assumption.statement}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="task-summary-section flex flex-col gap-1">
        <strong className="flex items-center gap-1.5 text-[11.5px] font-semibold">
          <ClipboardCheck size={13} />
          {t("orchestration.summary.evidence")}
        </strong>
        {evidence.length > 0 ? (
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
            {evidence.map((event) => (
              <li key={event.id} className="text-[11.5px] text-muted">
                {event.summary}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[11.5px] text-muted">
            {snapshot.brief.goalKind === "answer"
              ? t("orchestration.summary.evidenceNotRequired")
              : t("orchestration.summary.noEvidence")}
          </p>
        )}
      </div>

      {unresolved.length > 0 && (
        <div className="task-summary-section task-summary-unresolved flex flex-col gap-1">
          <strong className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warning">
            <CircleSlash2 size={13} />
            {t("orchestration.summary.unresolvedItems")}
          </strong>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {unresolved.map((node) => (
              <li
                key={node.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-warning/[0.06] px-2 py-1 text-[11.5px]"
              >
                <span className="min-w-0 truncate">{node.title}</span>
                <small className="shrink-0 text-muted">
                  {t(`orchestration.nodeStatus.${node.status}`)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(outputsCount > 0 || changeTotals) && (
        <div className="task-summary-actions flex flex-wrap gap-2">
          {outputsCount > 0 && (
            <button
              type="button"
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[11.5px] font-medium transition-colors select-none hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              onClick={openOutputs}
            >
              {t("orchestration.summary.viewOutputs")}
              <span className="task-summary-count-chip rounded-full bg-primary/[0.08] px-1.5 text-[10.5px] font-medium text-primary">
                {t("orchestration.summary.outputsCount", { count: outputsCount })}
              </span>
            </button>
          )}
          {changeTotals && changeTotals.files > 0 && (
            <button
              type="button"
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[11.5px] font-medium transition-colors select-none hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              onClick={reviewChanges}
            >
              {t("orchestration.summary.reviewChanges")}
              <span className="task-summary-count-chip rounded-full bg-surface-hover px-1.5 text-[10.5px] font-medium text-muted">
                {t("orchestration.summary.changesCount", {
                  count: changeTotals.files,
                  additions: changeTotals.additions,
                  deletions: changeTotals.deletions,
                })}
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
