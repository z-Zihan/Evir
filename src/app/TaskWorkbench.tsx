import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Crosshair,
  GitFork,
  LoaderCircle,
  ShieldAlert,
  Sparkles,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Button, Input, Tip } from "../components/ui";
import {
  PlanTimeline,
  TaskPauseStrip,
  TaskSectionCaption,
  TaskSectionHeading,
  TaskSectionTitle,
} from "../components/ai";
import { cn } from "../components/ui/utils";
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
} from "../features/orchestration/orchestration-session";
import { continueCurrentExecution } from "../features/orchestration/continue-orchestration";
import { useOrchestrationStore } from "../features/orchestration/orchestration-store";
import type { AgentRunRecord } from "../features/chat/agent-run-record";
import { AgentRunSummary } from "./AgentRunSummary";
import { useMemoryStore } from "../features/memory/memory-store";
import { getActiveWorkspaceRoot } from "../core/workspace/active-root";
import { getStructuredStorage } from "../runtime/structured-storage";
import type { UsageRecord } from "../core/storage/db";
import { TaskRunSummary } from "./TaskRunSummary";
import { EditableStep, reconcileFinishedStatus, useElapsedSeconds } from "./task-workbench-parts";

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
        className="task-workbench task-workbench-preparing mt-1 ml-8 max-w-[820px] min-w-0"
        aria-labelledby="task-workbench-title"
      >
        <TaskPauseStrip
          className="task-preparation-strip rounded-lg border border-border bg-surface-subtle"
          aria-live="polite"
          aria-busy="true"
        >
          <span
            className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <LoaderCircle size={14} className="animate-spin" />
          </span>
          <div className="task-preparation-copy min-w-0 flex-1 leading-snug">
            <div className="task-preparation-heading flex items-baseline gap-2">
              <strong id="task-workbench-title" className="text-[12.5px] font-semibold">
                {t(`orchestration.preparing.${preparationKey}Title`)}
              </strong>
              <span className="text-[11px] text-muted">
                {t("orchestration.preparing.elapsed", { seconds: elapsedSeconds })}
              </span>
            </div>
            <span className="text-[11.5px] text-muted">
              {t(`orchestration.preparing.${preparationKey}Description`)}
            </span>
            {elapsedSeconds >= 15 && (
              <small className="block text-[11px] text-warning">
                {t("orchestration.preparing.slow")}
              </small>
            )}
          </div>
          <Tip content={t("orchestration.stop")}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="task-preparation-stop font-normal"
              onClick={() => {
                stopGeneration();
                cancelTaskPreparation(preparing.conversationId);
              }}
              aria-label={t("orchestration.stop")}
            >
              <X size={13} aria-hidden="true" />
              <span>{t("chat.stop")}</span>
            </Button>
          </Tip>
        </TaskPauseStrip>
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
      className={cn(
        "task-workbench mt-1.5 ml-8 flex max-w-[820px] min-w-0 flex-col",
        finished ? "task-workbench-finished" : "",
      )}
      aria-labelledby="task-workbench-title"
    >
      {snapshot.brief.doneWhen && snapshot.brief.doneWhen.length > 0 && (
        <div
          className="goal-banner flex flex-col gap-1.5 border-b border-border bg-surface-subtle px-3.5 py-2.5"
          aria-label={t("goal.bannerLabel")}
        >
          <div className="goal-banner-objective flex items-center gap-1.5 text-[12px] font-medium">
            <Crosshair size={13} aria-hidden="true" className="shrink-0 text-primary" />
            <span>{snapshot.brief.objective}</span>
          </div>
          <ul className="goal-done-when m-0 flex list-none flex-col gap-1 p-0">
            {(snapshot.brief.doneWhenResults ?? []).length > 0
              ? (snapshot.brief.doneWhenResults ?? []).map((result) => (
                  <li
                    key={result.label}
                    className={cn(
                      "flex items-center gap-1.5 text-[11.5px]",
                      result.status === "passed" ? "met text-success" : undefined,
                      result.status === "failed" ? "unmet text-danger" : undefined,
                      !result.status || result.status === "manual" ? "text-muted" : undefined,
                    )}
                  >
                    {result.status === "passed" ? (
                      <CheckCircle2 size={12} aria-hidden="true" />
                    ) : result.status === "failed" ? (
                      <XCircle size={12} aria-hidden="true" />
                    ) : (
                      <Circle size={12} aria-hidden="true" />
                    )}
                    <span>{result.label}</span>
                    {result.status === "manual" && (
                      <small className="text-muted">{t("goal.manualCondition")}</small>
                    )}
                    {result.status === "failed" && result.evidence && (
                      <Tip content={result.evidence}>
                        <small className="text-danger/85">{t("goal.conditionFailed")}</small>
                      </Tip>
                    )}
                  </li>
                ))
              : snapshot.brief.doneWhen.map((condition) => (
                  <li
                    key={condition}
                    className="flex items-center gap-1.5 text-[11.5px] text-muted"
                  >
                    <Circle size={12} aria-hidden="true" />
                    {condition}
                  </li>
                ))}
          </ul>
        </div>
      )}
      {preferenceCandidate && preferenceChoice[snapshot.runId] === undefined && (
        <div
          className="preference-candidate flex flex-col gap-1.5 border-b border-border bg-primary/[0.04] px-3.5 py-3"
          role="region"
          aria-label={t("preference.title")}
        >
          <div className="preference-candidate-header flex items-center gap-1.5 text-[12px] font-semibold">
            <Sparkles size={13} aria-hidden="true" className="text-primary" />
            <strong>{t("preference.title")}</strong>
          </div>
          <p className="m-0 text-[11.5px] text-muted">{t("preference.description")}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {preferenceCandidate.map((constraint) => (
              <li key={constraint} className="text-[11.5px] text-foreground/90">
                {constraint}
              </li>
            ))}
          </ul>
          <div className="preference-candidate-actions flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void savePreference("global")}>
              {t("preference.rememberGlobal")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!projectRootForPreference}
              aria-label={!projectRootForPreference ? t("preference.noProject") : undefined}
              onClick={() => void savePreference("project")}
            >
              {t("preference.rememberProject")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setPreferenceChoice((choices) => ({ ...choices, [snapshot.runId]: "dismissed" }))
              }
            >
              {t("preference.ignore")}
            </Button>
          </div>
        </div>
      )}
      {preferenceChoice[snapshot.runId]?.startsWith("saved") && (
        <p
          className="preference-saved m-0 border-b border-border bg-success/[0.06] px-3.5 py-2 text-[11.5px] text-success"
          role="status"
        >
          {t(
            preferenceChoice[snapshot.runId] === "saved-global"
              ? "preference.savedGlobal"
              : "preference.savedProject",
          )}
        </p>
      )}
      <header
        className="task-status-bar flex min-h-11 items-center gap-2.5 border-b border-border px-3.5 py-2"
        aria-live="polite"
      >
        <span className="task-status-icon shrink-0 text-muted" aria-hidden="true">
          {snapshot.phase === "finished" ? (
            finishedStatus === "completed" ? (
              <CheckCircle2 size={16} className="text-success" />
            ) : finishedStatus === "failed" ? (
              <XCircle size={16} className="text-danger" />
            ) : (
              <ShieldAlert size={16} className="text-warning" />
            )
          ) : snapshot.phase === "clarification" ||
            snapshot.phase === "confirmation" ||
            snapshot.phase === "blocked" ? (
            <ShieldAlert size={16} className="text-warning" />
          ) : (
            <LoaderCircle size={16} className="animate-spin text-primary" />
          )}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <strong className="block text-[12.5px] font-semibold">
            {finished
              ? t(`orchestration.finishedStatus.${finishedStatus}`)
              : t(`orchestration.phase.${snapshot.phase}`)}
          </strong>
          <span className="block truncate text-[11.5px] text-muted">
            {active?.title ?? snapshot.brief.objective}
          </span>
        </div>
        <div className="task-status-actions flex shrink-0 items-center gap-1.5">
          {snapshot.phase === "execution" && (
            <Button variant="secondary" size="sm" onClick={() => pauseCurrentRun()}>
              {t("orchestration.pause")}
            </Button>
          )}
          {snapshot.phase === "paused" && (
            <Button variant="primary" size="sm" onClick={() => void resume()}>
              {t("orchestration.resume")}
            </Button>
          )}
          {snapshot.phase !== "finished" && (
            <Button variant="secondary" size="sm" onClick={stop}>
              {t("orchestration.stop")}
            </Button>
          )}
          {retryable && (
            <Button variant="primary" size="sm" onClick={() => void retry()}>
              {t("orchestration.retryTask")}
            </Button>
          )}
          {finished && (
            <Tip
              content={t(
                showFinishedDetails ? "orchestration.hideDetails" : "orchestration.showDetails",
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="task-icon-button"
                aria-expanded={showFinishedDetails}
                aria-label={t(
                  showFinishedDetails ? "orchestration.hideDetails" : "orchestration.showDetails",
                )}
                onClick={() => setShowFinishedDetails((value) => !value)}
              >
                <ChevronRight
                  className={cn("transition-transform", showFinishedDetails && "rotate-90")}
                  size={14}
                  aria-hidden="true"
                />
              </Button>
            </Tip>
          )}
        </div>
      </header>

      {snapshot.phase === "clarification" && (
        <form
          className="clarification-card flex flex-col gap-2.5 px-3.5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void answerCurrentClarifications(answers);
          }}
        >
          <TaskSectionHeading className="p-0">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <TaskSectionTitle>{t("orchestration.clarificationTitle")}</TaskSectionTitle>
              <TaskSectionCaption>{t("orchestration.clarificationDescription")}</TaskSectionCaption>
            </div>
          </TaskSectionHeading>
          {(snapshot.brief.assumptions.length > 0 ||
            snapshot.brief.unknowns.some(({ impact }) => impact === "data")) && (
            <details className="clarification-context rounded-lg border border-border bg-surface-subtle px-2.5 py-1.5 text-[12px]">
              <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{t("orchestration.assumptions")}</span>
                <small className="text-muted">
                  {t("orchestration.assumptionCount", {
                    count:
                      snapshot.brief.assumptions.length +
                      snapshot.brief.unknowns.filter(({ impact }) => impact === "data").length,
                  })}
                </small>
                <ChevronRight size={13} aria-hidden="true" className="text-muted" />
              </summary>
              <div className="clarification-context-details mt-2 grid gap-2 border-t border-border pt-2 md:grid-cols-2">
                {snapshot.brief.assumptions.length > 0 && (
                  <div>
                    <strong className="text-[11.5px]">{t("orchestration.assumptions")}</strong>
                    <ul className="m-1 mt-1.5 flex list-disc flex-col gap-0.5 pl-4">
                      {snapshot.brief.assumptions.map((assumption) => (
                        <li key={assumption.id} className="text-[11.5px] text-muted">
                          {assumption.statement}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {snapshot.brief.unknowns.some(({ impact }) => impact === "data") && (
                  <div>
                    <strong className="text-[11.5px]">{t("orchestration.dataDestination")}</strong>
                    <ul className="m-1 mt-1.5 flex list-disc flex-col gap-0.5 pl-4">
                      {snapshot.brief.unknowns
                        .filter(({ impact }) => impact === "data")
                        .map((unknown) => (
                          <li key={unknown.id} className="text-[11.5px] text-muted">
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
            <fieldset
              className="clarification-question m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
              key={question.id}
            >
              <legend className="flex items-baseline gap-2 p-0 text-[12.5px] font-medium">
                <span aria-hidden="true" className="font-mono text-[11px] text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {question.question}
              </legend>
              {question.suggestedAnswers.length > 0 && (
                <div className="clarification-suggestions flex flex-wrap gap-1.5">
                  {question.suggestedAnswers.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      aria-pressed={answers[question.id] === suggestion}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                        answers[question.id] === suggestion
                          ? "border-primary bg-primary/[0.08] font-medium text-primary"
                          : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
                      )}
                      onClick={() =>
                        setAnswers((value) => ({ ...value, [question.id]: suggestion }))
                      }
                    >
                      <span>{suggestion}</span>
                      {answers[question.id] === suggestion && (
                        <CheckCircle2 size={13} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <Input
                ref={index === 0 ? firstQuestionRef : undefined}
                value={answers[question.id] ?? ""}
                onChange={(event) =>
                  setAnswers((value) => ({ ...value, [question.id]: event.target.value }))
                }
                placeholder={t("orchestration.answerPlaceholder")}
                className="h-8 text-[12.5px]"
              />
            </fieldset>
          ))}
          <div className="task-actions clarification-actions flex justify-end">
            <Button
              variant="primary"
              size="default"
              type="submit"
              disabled={questions.some(({ id }) => !answers[id]?.trim())}
            >
              {t("orchestration.continue")}
            </Button>
          </div>
        </form>
      )}

      {snapshot.phase === "blocked" && (
        <div className="clarification-card flex flex-col gap-2.5 px-3.5 py-3" role="status">
          <TaskSectionHeading className="p-0">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <TaskSectionTitle>{t("orchestration.blockedTitle")}</TaskSectionTitle>
              <TaskSectionCaption>{t("orchestration.blockedDescription")}</TaskSectionCaption>
            </div>
          </TaskSectionHeading>
          <div className="task-actions flex justify-end">
            <Button variant="secondary" size="sm" onClick={stop}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {plan && (!finished || showFinishedDetails) && (
        <div className="plan-timeline-wrap flex flex-col gap-1 px-3.5 py-2.5">
          <TaskSectionHeading className="p-0">
            <GitFork size={14} className="mt-0.5 shrink-0 text-muted" />
            <div>
              <TaskSectionTitle>{t("orchestration.planTitle")}</TaskSectionTitle>
              <TaskSectionCaption>
                {t("orchestration.planRevision", { revision: plan.revision })}
              </TaskSectionCaption>
            </div>
          </TaskSectionHeading>
          <PlanTimeline className="my-1 px-3">
            {plan.nodes.map((node) => (
              <EditableStep key={node.id} node={node} />
            ))}
          </PlanTimeline>
          {(snapshot.phase === "confirmation" ||
            (snapshot.phase === "paused" &&
              plan.nodes.some(
                (node) => node.kind === "approval" && node.status === "blocked",
              ))) && (
            <div className="task-actions flex justify-end gap-2">
              <Button
                ref={rejectPlanRef}
                type="button"
                variant="secondary"
                size="sm"
                onClick={stop}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void confirmCurrentPlan()}
              >
                {t("orchestration.confirmPlan")}
              </Button>
            </div>
          )}
          <details className="graph-inspector rounded-lg border border-border bg-surface-subtle px-2.5 py-1.5 text-[12px]">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-muted select-none [&::-webkit-details-marker]:hidden">
              <GitFork size={13} />
              {t("orchestration.graphDetails")}
              <ChevronRight size={13} />
            </summary>
            <ul className="m-1 mt-2 flex list-none flex-col gap-0.5 border-t border-border pt-2 font-mono text-[11px]">
              {plan.edges.map((edge) => (
                <li
                  key={`${edge.from}:${edge.to}:${edge.when}`}
                  className="flex items-center gap-1.5"
                >
                  <code className="rounded bg-surface-hover px-1 py-px">{edge.from}</code>
                  <span className="text-muted">→</span>
                  <code className="rounded bg-surface-hover px-1 py-px">{edge.to}</code>
                  <span className="text-muted">{edge.when}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {snapshot.assignments.length > 0 && (!finished || showFinishedDetails) && (
        <div className="agent-group flex flex-col gap-1 border-t border-border px-3.5 py-2.5">
          <TaskSectionHeading className="p-0">
            <Users size={14} className="mt-0.5 shrink-0 text-muted" />
            <TaskSectionTitle>{t("orchestration.agents")}</TaskSectionTitle>
          </TaskSectionHeading>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {snapshot.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-surface-subtle px-2.5 py-1.5 text-[11.5px]"
              >
                <span className="min-w-0 truncate text-foreground/90">{assignment.objective}</span>
                <strong className="shrink-0 font-medium text-muted">
                  {t(`orchestration.agentStatus.${assignment.status}`)}
                </strong>
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
        <div
          className="goal-usage flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border px-3.5 py-1.5 text-[10.5px] text-muted"
          aria-label={t("goal.usageLabel")}
        >
          <span>
            {t("goal.usageElapsed", {
              seconds: Math.max(1, Math.round(goalUsage.elapsedMs / 1000)),
            })}
          </span>
          <span>{t("goal.usageAgents", { count: goalUsage.agentRuns })}</span>
          <span>{t("goal.usageTools", { count: goalUsage.toolCalls })}</span>
          {goalTokens !== null && <span>{t("goal.usageTokens", { count: goalTokens })}</span>}
          {goalTokens !== null && <small className="text-muted">{t("goal.usageEstimated")}</small>}
        </div>
      )}
    </section>
  );
}
