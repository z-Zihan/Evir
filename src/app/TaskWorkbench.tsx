import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleSlash2,
  Crosshair,
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
  retryCurrentRun,
  reviseCurrentPlan,
} from "../features/orchestration/orchestration-session";
import { continueCurrentExecution } from "../features/orchestration/continue-orchestration";
import { useOrchestrationStore } from "../features/orchestration/orchestration-store";
import type { NodeStatus, PlanGraph, PlanNode } from "../core/orchestration/types";
import type { AgentRunRecord, AgentRunStatus } from "../features/chat/agent-run-record";
import { AgentRunSummary } from "./AgentRunSummary";
import { useMemoryStore } from "../features/memory/memory-store";
import { getActiveWorkspaceRoot } from "../core/workspace/active-root";
import { getStructuredStorage } from "../runtime/structured-storage";
import type { UsageRecord } from "../core/storage/db";
import { Sparkles } from "lucide-react";
import { TaskRunSummary } from "./TaskRunSummary";

type FinishedStatus = "completed" | "partial" | "failed" | "cancelled";

function reconcileFinishedStatus(
  planStatus: PlanGraph["status"] | undefined,
  agentStatus: AgentRunStatus | undefined,
  answerOnly: boolean,
): FinishedStatus {
  if (agentStatus === "failed") return "failed";
  if (agentStatus === "cancelled") return "cancelled";
  if (answerOnly && agentStatus === "needs_verification") {
    return planStatus === "completed" ? "completed" : "partial";
  }
  if (["awaiting_approval", "needs_verification", "rolled_back"].includes(agentStatus ?? ""))
    return "partial";
  if (["completed", "partial", "failed", "cancelled"].includes(planStatus ?? ""))
    return planStatus as FinishedStatus;
  return "partial";
}

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
          data-tip={t("orchestration.editStep")}
        >
          <Pencil size={13} />
        </button>
      )}
    </li>
  );
}

export function TaskWorkbench({ agentRun }: { agentRun?: AgentRunRecord | undefined }) {
  const { t } = useTranslation();
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const privateSession = useChatStore((state) => state.privateSession);
  const stopGeneration = useChatStore((state) => state.stopGeneration);
  const snapshot = useOrchestrationStore((state) => state.current);
  const addMemory = useMemoryStore((state) => state.addMemory);
  const goalUsage = useMemo(() => {
    if (!snapshot) return null;
    const events = snapshot.events;
    const started = events.find(({ type }) => type === "run.started")?.timestamp ?? 0;
    const ended =
      events.filter(({ type }) => type.startsWith("run.") || type.startsWith("goal.")).at(-1)
        ?.timestamp ?? Date.now();
    const toolCalls = events.filter(({ type }) => type === "tool.completed").length;
    const agentRuns = snapshot.assignments.length;
    return {
      elapsedMs: Math.max(0, ended - started),
      agentRuns,
      toolCalls,
    };
  }, [snapshot]);
  const [goalTokens, setGoalTokens] = useState<number | null>(null);
  useEffect(() => {
    if (!snapshot || snapshot.phase !== "finished") return;
    let cancelled = false;
    void getStructuredStorage()
      .query<UsageRecord>("usage_records", { conversationId: snapshot.conversationId })
      .then((records) => {
        if (cancelled) return;
        const since = snapshot.events.find(({ type }) => type === "run.started")?.timestamp ?? 0;
        setGoalTokens(
          records
            .filter((record) => record.createdAt >= since)
            .reduce(
              (sum, record) =>
                sum +
                (record.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0)),
              0,
            ),
        );
      })
      .catch(() => setGoalTokens(null));
    return () => {
      cancelled = true;
    };
  }, [snapshot]);
  const [preferenceChoice, setPreferenceChoice] = useState<
    Record<string, "saved-global" | "saved-project" | "dismissed">
  >({});
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
            data-tip={t("orchestration.stop")}
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
  const matchingAgentRun =
    agentRun?.conversationId === currentConversationId ? agentRun : undefined;
  const finishedStatus = reconcileFinishedStatus(
    plan?.status,
    matchingAgentRun?.status,
    snapshot.brief.goalKind === "answer",
  );
  const active = plan?.nodes.find(({ status }) => status === "running" || status === "ready");
  const preferenceCandidate =
    finished && finishedStatus === "completed" && (snapshot.brief.constraints?.length ?? 0) > 0
      ? snapshot.brief.constraints
      : null;
  const projectRootForPreference = getActiveWorkspaceRoot();
  const savePreference = async (scope: "global" | "project") => {
    if (!preferenceCandidate) return;
    const objective = snapshot.brief.objective.slice(0, 60);
    await addMemory({
      type: "long-term",
      scope: scope === "global" ? "global" : (projectRootForPreference ?? ""),
      key: `preference:${snapshot.runId}`,
      content: `任务「${objective}」中用户设定的约束，或为长期偏好：${preferenceCandidate.join("；")}`,
      confidence: 0.6,
    });
    setPreferenceChoice((choices) => ({
      ...choices,
      [snapshot.runId]: scope === "global" ? "saved-global" : "saved-project",
    }));
  };
  const stop = () => {
    stopGeneration();
    void cancelCurrentRun(getRuntime(), privateSession);
  };
  const resume = async () => {
    if (await resumeCurrentRun(getRuntime(), privateSession)) await continueCurrentExecution();
  };
  const retry = async () => {
    if (await retryCurrentRun(getRuntime(), privateSession)) await continueCurrentExecution();
  };
  const retryable =
    finished &&
    (finishedStatus === "failed" || finishedStatus === "cancelled" || finishedStatus === "partial");

  return (
    <section
      className={`task-workbench${finished ? " task-workbench-finished" : ""}`}
      aria-labelledby="task-workbench-title"
    >
      {snapshot.brief.doneWhen && snapshot.brief.doneWhen.length > 0 && (
        <div className="goal-banner" aria-label={t("goal.bannerLabel")}>
          <div className="goal-banner-objective">
            <Crosshair size={13} aria-hidden="true" />
            <span>{snapshot.brief.objective}</span>
          </div>
          <ul className="goal-done-when">
            {(snapshot.brief.doneWhenResults ?? []).length > 0
              ? (snapshot.brief.doneWhenResults ?? []).map((result) => (
                  <li
                    key={result.label}
                    className={
                      result.status === "passed"
                        ? "met"
                        : result.status === "failed"
                          ? "unmet"
                          : undefined
                    }
                  >
                    {result.status === "passed" ? (
                      <CheckCircle2 size={12} aria-hidden="true" />
                    ) : result.status === "failed" ? (
                      <XCircle size={12} aria-hidden="true" />
                    ) : (
                      <Circle size={12} aria-hidden="true" />
                    )}
                    <span>{result.label}</span>
                    {result.status === "manual" && <small>{t("goal.manualCondition")}</small>}
                    {result.status === "failed" && result.evidence && (
                      <small data-tip={result.evidence}>{t("goal.conditionFailed")}</small>
                    )}
                  </li>
                ))
              : snapshot.brief.doneWhen.map((condition) => (
                  <li key={condition}>
                    <Circle size={12} aria-hidden="true" />
                    {condition}
                  </li>
                ))}
          </ul>
        </div>
      )}
      {preferenceCandidate && preferenceChoice[snapshot.runId] === undefined && (
        <div className="preference-candidate" role="region" aria-label={t("preference.title")}>
          <div className="preference-candidate-header">
            <Sparkles size={13} aria-hidden="true" />
            <strong>{t("preference.title")}</strong>
          </div>
          <p>{t("preference.description")}</p>
          <ul>
            {preferenceCandidate.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
          <div className="preference-candidate-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void savePreference("global")}
            >
              {t("preference.rememberGlobal")}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!projectRootForPreference}
              data-tip={!projectRootForPreference ? t("preference.noProject") : undefined}
              onClick={() => void savePreference("project")}
            >
              {t("preference.rememberProject")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setPreferenceChoice((choices) => ({ ...choices, [snapshot.runId]: "dismissed" }))
              }
            >
              {t("preference.ignore")}
            </button>
          </div>
        </div>
      )}
      {preferenceChoice[snapshot.runId]?.startsWith("saved") && (
        <p className="preference-saved" role="status">
          {t(
            preferenceChoice[snapshot.runId] === "saved-global"
              ? "preference.savedGlobal"
              : "preference.savedProject",
          )}
        </p>
      )}
      <header className="task-status-bar" aria-live="polite">
        <span className="task-status-icon" aria-hidden="true">
          {snapshot.phase === "finished" ? (
            <RunIcon status={finishedStatus} />
          ) : snapshot.phase === "clarification" ||
            snapshot.phase === "confirmation" ||
            snapshot.phase === "blocked" ? (
            <PauseCircle size={16} />
          ) : (
            <LoaderCircle size={16} className="spin" />
          )}
        </span>
        <div>
          <strong id="task-workbench-title">
            {finished
              ? t(`orchestration.finishedStatus.${finishedStatus}`)
              : t(`orchestration.phase.${snapshot.phase}`)}
          </strong>
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
          {retryable && (
            <button type="button" className="primary-button" onClick={() => void retry()}>
              {t("orchestration.retryTask")}
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
              data-tip={t(
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
          {(snapshot.phase === "confirmation" ||
            (snapshot.phase === "paused" &&
              plan.nodes.some(
                (node) => node.kind === "approval" && node.status === "blocked",
              ))) && (
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

      {(!finished || showFinishedDetails) && (
        <TaskRunSummary
          snapshot={snapshot}
          statusOverride={finished ? finishedStatus : undefined}
        />
      )}
      {finished && matchingAgentRun && (
        <div hidden={!showFinishedDetails}>
          <AgentRunSummary record={matchingAgentRun} embedded />
        </div>
      )}

      {goalUsage && (
        <div className="goal-usage" aria-label={t("goal.usageLabel")}>
          <span>
            {t("goal.usageElapsed", {
              seconds: Math.max(1, Math.round(goalUsage.elapsedMs / 1000)),
            })}
          </span>
          <span>{t("goal.usageAgents", { count: goalUsage.agentRuns })}</span>
          <span>{t("goal.usageTools", { count: goalUsage.toolCalls })}</span>
          {goalTokens !== null && <span>{t("goal.usageTokens", { count: goalTokens })}</span>}
          {goalTokens !== null && <small>{t("goal.usageEstimated")}</small>}
        </div>
      )}
    </section>
  );
}
