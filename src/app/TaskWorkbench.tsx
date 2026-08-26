import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleSlash2,
  GitFork,
  LoaderCircle,
  PauseCircle,
  Pencil,
  ShieldAlert,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { getRuntime } from "../runtime/use-runtime";
import { useChatStore } from "../features/chat/chat-store";
import {
  answerCurrentClarifications,
  confirmCurrentPlan,
} from "../features/orchestration/continue-orchestration";
import {
  cancelCurrentRun,
  cancelTaskPreparation,
  pauseCurrentRun,
  resumeCurrentRun,
  reviseCurrentPlan,
} from "../features/orchestration/orchestration-session";
import { continueCurrentExecution } from "../features/orchestration/continue-orchestration";
import { useOrchestrationStore } from "../features/orchestration/orchestration-store";
import type { NodeStatus, PlanGraph, PlanNode } from "../core/orchestration/types";
import { TaskRunSummary } from "./TaskRunSummary";

function NodeIcon({ status }: { status: NodeStatus }) {
  if (status === "running") return <LoaderCircle size={14} className="spin" />;
  if (status === "completed") return <CheckCircle2 size={14} />;
  if (status === "failed") return <XCircle size={14} />;
  if (status === "cancelled" || status === "skipped") return <CircleSlash2 size={14} />;
  if (status === "blocked") return <ShieldAlert size={14} />;
  if (status === "ready") return <CircleDashed size={14} />;
  return <Circle size={14} />;
}

function RunIcon({ status }: { status: PlanGraph["status"] | undefined }) {
  if (status === "failed") return <XCircle size={16} />;
  if (status === "cancelled") return <CircleSlash2 size={16} />;
  if (status === "partial" || status === "paused") return <ShieldAlert size={16} />;
  return <CheckCircle2 size={16} />;
}

function useElapsedSeconds(startedAt: number | undefined): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)) : 0,
  );

  useEffect(() => {
    if (!startedAt) {
      setElapsedSeconds(0);
      return;
    }
    const update = () =>
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return elapsedSeconds;
}

function EditableStep({ node }: { node: PlanNode }) {
  const { t } = useTranslation();
  const privateSession = useChatStore((state) => state.privateSession);
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(node.objective);
  const save = async () => {
    if (await reviseCurrentPlan(node.id, objective, getRuntime(), privateSession))
      setEditing(false);
  };
  return (
    <li className={`task-step task-step-${node.status}`}>
      <span className="task-step-marker" aria-hidden="true">
        <NodeIcon status={node.status} />
      </span>
      <div className="task-step-copy">
        <strong>{node.title}</strong>
        {editing ? (
          <div className="task-step-editor">
            <input
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              aria-label={t("orchestration.editStep")}
            />
            <button type="button" onClick={() => void save()}>
              {t("common.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <span>{node.objective}</span>
        )}
      </div>
      {node.status === "pending" && !editing && (
        <button
          className="task-icon-button"
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t("orchestration.editStep")}
          title={t("orchestration.editStep")}
        >
          <Pencil size={13} />
        </button>
      )}
    </li>
  );
}

export function TaskWorkbench() {
  const { t } = useTranslation();
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const privateSession = useChatStore((state) => state.privateSession);
  const stopGeneration = useChatStore((state) => state.stopGeneration);
  const snapshot = useOrchestrationStore((state) => state.current);
  const preparing = useOrchestrationStore((state) => state.preparing);
  const elapsedSeconds = useElapsedSeconds(preparing?.startedAt);
  const questions = useMemo(
    () =>
      snapshot?.brief.unknowns.filter(
        ({ impact, answer }) => impact !== "non-blocking" && !answer,
      ) ?? [],
    [snapshot],
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showFinishedDetails, setShowFinishedDetails] = useState(false);
  const firstQuestionRef = useRef<HTMLInputElement>(null);
  const rejectPlanRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (snapshot?.phase === "clarification") firstQuestionRef.current?.focus();
    if (snapshot?.phase === "confirmation") rejectPlanRef.current?.focus();
  }, [snapshot?.phase]);

  if (
    (!snapshot || snapshot.conversationId !== currentConversationId) &&
    preparing?.conversationId === currentConversationId
  ) {
    const preparationKey = preparing.stage === "planning" ? "planning" : "intake";
    return (
      <section
        className="task-workbench task-workbench-preparing"
        aria-labelledby="task-workbench-title"
      >
        <div className="task-preparation-strip" aria-live="polite" aria-busy="true">
          <span className="task-preparation-icon" aria-hidden="true">
            <LoaderCircle size={15} className="spin" />
          </span>
          <div className="task-preparation-copy">
            <div className="task-preparation-heading">
              <strong id="task-workbench-title">
                {t(`orchestration.preparing.${preparationKey}Title`)}
              </strong>
              <span>{t("orchestration.preparing.elapsed", { seconds: elapsedSeconds })}</span>
            </div>
            <span>{t(`orchestration.preparing.${preparationKey}Description`)}</span>
            {elapsedSeconds >= 15 && <small>{t("orchestration.preparing.slow")}</small>}
          </div>
          <button
            type="button"
            className="task-preparation-stop"
            onClick={() => {
              stopGeneration();
              cancelTaskPreparation(preparing.conversationId);
            }}
            aria-label={t("orchestration.stop")}
            title={t("orchestration.stop")}
          >
            <X size={14} aria-hidden="true" />
            <span>{t("chat.stop")}</span>
          </button>
        </div>
      </section>
    );
  }
  if (!snapshot || snapshot.conversationId !== currentConversationId) return null;
  const plan = snapshot.plan;
  const finished = snapshot.phase === "finished";
  const active = plan?.nodes.find(({ status }) => status === "running" || status === "ready");
  const stop = () => {
    stopGeneration();
    void cancelCurrentRun(getRuntime(), privateSession);
  };
  const resume = async () => {
    if (await resumeCurrentRun(getRuntime(), privateSession)) await continueCurrentExecution();
  };

  return (
    <section
      className={`task-workbench${finished ? " task-workbench-finished" : ""}`}
      aria-labelledby="task-workbench-title"
    >
      <header className="task-status-bar" aria-live="polite">
        <span className="task-status-icon" aria-hidden="true">
          {snapshot.phase === "finished" ? (
            <RunIcon status={plan?.status} />
          ) : snapshot.phase === "clarification" ||
            snapshot.phase === "confirmation" ||
            snapshot.phase === "blocked" ? (
            <PauseCircle size={16} />
          ) : (
            <LoaderCircle size={16} className="spin" />
          )}
        </span>
        <div>
          <strong id="task-workbench-title">{t(`orchestration.phase.${snapshot.phase}`)}</strong>
          <span>{active?.title ?? snapshot.brief.objective}</span>
        </div>
        <div className="task-status-actions">
          {snapshot.phase === "execution" && (
            <button type="button" className="secondary-button" onClick={() => pauseCurrentRun()}>
              {t("orchestration.pause")}
            </button>
          )}
          {snapshot.phase === "paused" && (
            <button type="button" className="primary-button" onClick={() => void resume()}>
              {t("orchestration.resume")}
            </button>
          )}
          {snapshot.phase !== "finished" && (
            <button type="button" className="secondary-button" onClick={stop}>
              {t("orchestration.stop")}
            </button>
          )}
          {finished && (
            <button
              type="button"
              className="task-icon-button"
              aria-expanded={showFinishedDetails}
              aria-label={t(
                showFinishedDetails ? "orchestration.hideDetails" : "orchestration.showDetails",
              )}
              title={t(
                showFinishedDetails ? "orchestration.hideDetails" : "orchestration.showDetails",
              )}
              onClick={() => setShowFinishedDetails((value) => !value)}
            >
              <ChevronRight
                className={showFinishedDetails ? "task-details-chevron-open" : ""}
                size={14}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </header>

      {snapshot.phase === "clarification" && (
        <form
          className="clarification-card"
          onSubmit={(event) => {
            event.preventDefault();
            void answerCurrentClarifications(answers);
          }}
        >
          <div className="clarification-heading">
            <span className="clarification-heading-icon" aria-hidden="true">
              <ShieldAlert size={15} />
            </span>
            <div>
              <strong>{t("orchestration.clarificationTitle")}</strong>
              <span>{t("orchestration.clarificationDescription")}</span>
            </div>
          </div>
          {(snapshot.brief.assumptions.length > 0 ||
            snapshot.brief.unknowns.some(({ impact }) => impact === "data")) && (
            <details className="clarification-context">
              <summary>
                <span>{t("orchestration.assumptions")}</span>
                <small>
                  {t("orchestration.assumptionCount", {
                    count:
                      snapshot.brief.assumptions.length +
                      snapshot.brief.unknowns.filter(({ impact }) => impact === "data").length,
                  })}
                </small>
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <div className="clarification-context-details">
                {snapshot.brief.assumptions.length > 0 && (
                  <div>
                    <strong>{t("orchestration.assumptions")}</strong>
                    <ul>
                      {snapshot.brief.assumptions.map((assumption) => (
                        <li key={assumption.id}>{assumption.statement}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {snapshot.brief.unknowns.some(({ impact }) => impact === "data") && (
                  <div>
                    <strong>{t("orchestration.dataDestination")}</strong>
                    <ul>
                      {snapshot.brief.unknowns
                        .filter(({ impact }) => impact === "data")
                        .map((unknown) => (
                          <li key={unknown.id}>
                            {unknown.answer ||
                              unknown.suggestedAnswers.join(" / ") ||
                              unknown.question}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
          {questions.map((question, index) => (
            <fieldset className="clarification-question" key={question.id}>
              <legend>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {question.question}
              </legend>
              {question.suggestedAnswers.length > 0 && (
                <div className="clarification-suggestions">
                  {question.suggestedAnswers.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      aria-pressed={answers[question.id] === suggestion}
                      onClick={() =>
                        setAnswers((value) => ({ ...value, [question.id]: suggestion }))
                      }
                    >
                      <span>{suggestion}</span>
                      {answers[question.id] === suggestion && (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={index === 0 ? firstQuestionRef : undefined}
                value={answers[question.id] ?? ""}
                onChange={(event) =>
                  setAnswers((value) => ({ ...value, [question.id]: event.target.value }))
                }
                placeholder={t("orchestration.answerPlaceholder")}
              />
            </fieldset>
          ))}
          <div className="task-actions clarification-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={questions.some(({ id }) => !answers[id]?.trim())}
            >
              {t("orchestration.continue")}
            </button>
          </div>
        </form>
      )}

      {snapshot.phase === "blocked" && (
        <div className="clarification-card" role="status">
          <div className="task-section-heading">
            <ShieldAlert size={15} />
            <div>
              <strong>{t("orchestration.blockedTitle")}</strong>
              <span>{t("orchestration.blockedDescription")}</span>
            </div>
          </div>
          <div className="task-actions">
            <button type="button" className="secondary-button" onClick={stop}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {plan && (!finished || showFinishedDetails) && (
        <div className="plan-timeline">
          <div className="task-section-heading">
            <GitFork size={15} />
            <div>
              <strong>{t("orchestration.planTitle")}</strong>
              <span>{t("orchestration.planRevision", { revision: plan.revision })}</span>
            </div>
          </div>
          <ol>
            {plan.nodes.map((node) => (
              <EditableStep key={node.id} node={node} />
            ))}
          </ol>
          {snapshot.phase === "confirmation" && (
            <div className="task-actions">
              <button ref={rejectPlanRef} type="button" className="secondary-button" onClick={stop}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void confirmCurrentPlan()}
              >
                {t("orchestration.confirmPlan")}
              </button>
            </div>
          )}
          <details className="graph-inspector">
            <summary>
              <GitFork size={14} />
              {t("orchestration.graphDetails")}
              <ChevronRight size={14} />
            </summary>
            <ul>
              {plan.edges.map((edge) => (
                <li key={`${edge.from}:${edge.to}:${edge.when}`}>
                  <code>{edge.from}</code>
                  <span>→</span>
                  <code>{edge.to}</code>
                  <span>{edge.when}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {snapshot.assignments.length > 0 && (!finished || showFinishedDetails) && (
        <div className="agent-group">
          <div className="task-section-heading">
            <Users size={15} />
            <strong>{t("orchestration.agents")}</strong>
          </div>
          <ul>
            {snapshot.assignments.map((assignment) => (
              <li key={assignment.id}>
                <span>{assignment.objective}</span>
                <strong>{t(`orchestration.agentStatus.${assignment.status}`)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(!finished || showFinishedDetails) && <TaskRunSummary snapshot={snapshot} />}
    </section>
  );
}
