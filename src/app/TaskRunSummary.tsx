import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash2, ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OrchestrationSnapshot } from "../core/orchestration/types";
import { useRunWorkspaceStore } from "../features/workspace/workspace-run-store";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { useActiveWorkspaceRoot } from "../features/workspace/workspace-bridge";
import { logger } from "../core/logging/logger";

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
      className={`task-run-summary task-run-summary-${status}`}
      aria-labelledby="task-run-summary-title"
    >
      <div className="task-section-heading">
        {successful ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <div>
          <strong id="task-run-summary-title">{t("orchestration.summary.title")}</strong>
          <span>{t(`orchestration.summary.status.${status}`)}</span>
        </div>
      </div>
      <p className="task-summary-result">{snapshot.brief.objective}</p>

      <dl className="task-summary-counts">
        <div>
          <dt>{t("orchestration.summary.completed")}</dt>
          <dd>{completed.length}</dd>
        </div>
        <div>
          <dt>{t("orchestration.summary.unresolved")}</dt>
          <dd>{unresolved.length}</dd>
        </div>
        <div>
          <dt>{t("orchestration.summary.skipped")}</dt>
          <dd>{skipped.length}</dd>
        </div>
      </dl>

      {snapshot.brief.assumptions.length > 0 && (
        <div className="task-summary-section">
          <strong>{t("orchestration.assumptions")}</strong>
          <ul>
            {snapshot.brief.assumptions.map((assumption) => (
              <li key={assumption.id}>{assumption.statement}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="task-summary-section">
        <strong>
          <ClipboardCheck size={14} />
          {t("orchestration.summary.evidence")}
        </strong>
        {evidence.length > 0 ? (
          <ul>
            {evidence.map((event) => (
              <li key={event.id}>{event.summary}</li>
            ))}
          </ul>
        ) : (
          <p>
            {snapshot.brief.goalKind === "answer"
              ? t("orchestration.summary.evidenceNotRequired")
              : t("orchestration.summary.noEvidence")}
          </p>
        )}
      </div>

      {unresolved.length > 0 && (
        <div className="task-summary-section task-summary-unresolved">
          <strong>
            <CircleSlash2 size={14} />
            {t("orchestration.summary.unresolvedItems")}
          </strong>
          <ul>
            {unresolved.map((node) => (
              <li key={node.id}>
                <span>{node.title}</span>
                <small>{t(`orchestration.nodeStatus.${node.status}`)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(outputsCount > 0 || changeTotals) && (
        <div className="task-summary-actions">
          {outputsCount > 0 && (
            <button type="button" className="secondary-button" onClick={openOutputs}>
              {t("orchestration.summary.viewOutputs")}
              <span className="task-summary-count-chip">
                {t("orchestration.summary.outputsCount", { count: outputsCount })}
              </span>
            </button>
          )}
          {changeTotals && changeTotals.files > 0 && (
            <button type="button" className="secondary-button" onClick={reviewChanges}>
              {t("orchestration.summary.reviewChanges")}
              <span className="task-summary-count-chip">
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
