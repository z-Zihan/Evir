import { AlertTriangle, CheckCircle2, CircleSlash2, ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OrchestrationSnapshot } from "../core/orchestration/types";

export function TaskRunSummary({ snapshot }: { snapshot: OrchestrationSnapshot }) {
  const { t } = useTranslation();
  const plan = snapshot.plan;
  if (!plan || snapshot.phase !== "finished") return null;

  const completed = plan.nodes.filter(({ status }) => status === "completed");
  const unresolved = plan.nodes.filter(({ status }) =>
    ["failed", "blocked", "cancelled"].includes(status),
  );
  const skipped = plan.nodes.filter(({ status }) => status === "skipped");
  const evidence = snapshot.events.filter(({ type }) => type === "verification.completed");
  const successful = plan.status === "completed";

  return (
    <section
      className={`task-run-summary task-run-summary-${plan.status}`}
      aria-labelledby="task-run-summary-title"
    >
      <div className="task-section-heading">
        {successful ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <div>
          <strong id="task-run-summary-title">{t("orchestration.summary.title")}</strong>
          <span>{t(`orchestration.summary.status.${plan.status}`)}</span>
        </div>
      </div>

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
    </section>
  );
}
