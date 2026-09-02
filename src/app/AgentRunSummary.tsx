import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Clock3,
  FileCode2,
  FilePlus2,
  GitCompareArrows,
  ImageIcon,
  LoaderCircle,
  PackageOpen,
  RotateCcw,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { getRuntime } from "../runtime/use-runtime";
import {
  runVerification,
  getGitDiff,
  getGitStatus,
  type VerificationResult,
} from "../core/tools/verification";
import { rollbackAgentRun, type AgentRunRecord } from "../features/chat/agent-run-record";
import { useChatStore } from "../features/chat/chat-store";
import { useActiveWorkspaceRoot } from "../features/workspace/workspace-bridge";
import { deriveChanges } from "../features/workspace/changes-model";
import { deriveTaskOutputs, type TaskOutput } from "../features/workspace/task-output-model";
import { relativeToRoot, summarizeRunChanges } from "../features/workspace/workspace-services";
import { useWorkspacePanelStore } from "../features/workspace/workspace-panel-store";
import { useConfirmationDialog } from "./useConfirmationDialog";

interface AgentRunSummaryProps {
  record: AgentRunRecord;
  onLayoutChange?: () => void;
  embedded?: boolean;
}

interface GitInfo {
  isRepo: boolean;
  entries: Array<{ status: string; file: string }>;
  branch: string | null;
}

/**
 * Result Summary: the post-run card that answers "what changed, what was
 * produced, what was verified" from run records — never from the model's
 * self-description. [Review changes] routes to the workspace Changes tab.
 */
export function AgentRunSummary({
  record,
  onLayoutChange,
  embedded = false,
}: AgentRunSummaryProps) {
  const { t } = useTranslation();
  const { id: runId, toolCalls, toolResults, maxIterationsReached, snapshots } = record;
  const workspace = useActiveWorkspaceRoot();
  const privateSession = useChatStore((state) => state.privateSession);
  const openPanel = useWorkspacePanelStore((state) => state.openPanel);
  const openResource = useWorkspacePanelStore((state) => state.openResource);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null);

  const changes = deriveChanges(toolCalls, toolResults, snapshots, record.id);
  const outputs: TaskOutput[] =
    record.taskOutputs ??
    deriveTaskOutputs(toolCalls, toolResults, snapshots, {
      runId: record.id,
      conversationId: record.conversationId,
    });

  useEffect(() => {
    onLayoutChange?.();
  }, [verification, diff, gitInfo, loading, diffStats, onLayoutChange]);

  useEffect(() => {
    if (
      !workspace ||
      record.verificationEvidence.some(({ summary }) => summary.startsWith("automatic:"))
    )
      return;
    const runtime = getRuntime();
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      runVerification(workspace, runtime),
      getGitDiff(workspace, runtime),
      getGitStatus(workspace, runtime),
    ])
      .then(([v, d, g]) => {
        if (cancelled) return;
        setVerification(v);
        setDiff(d);
        setGitInfo(g);
        setLoading(false);
      })
      .catch(() => {
        // A deleted workspace folder or failed invoke must not wedge the
        // summary in the loading state (or setState after unmount).
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Record-promoting automatic verification is owned by the data layer
    // (finalizeAutomaticVerification); this component only renders evidence.
  }, [workspace, runId, record, onLayoutChange]);

  useEffect(() => {
    if (!workspace || changes.length === 0) {
      setDiffStats(null);
      return;
    }
    let cancelled = false;
    void summarizeRunChanges(record, changes, workspace)
      .then((summary) => {
        if (!cancelled)
          setDiffStats({ additions: summary.additions, deletions: summary.deletions });
      })
      .catch(() => {
        if (!cancelled) setDiffStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [record, changes, workspace, runId]);

  const requestRollback = () => {
    requestConfirmation(
      {
        title: t("agent.rollbackTitle"),
        description: t("agent.rollbackDescription", { count: snapshots.length }),
        confirmLabel: t("agent.rollback"),
        tone: "warning",
      },
      async () => {
        const updated = await rollbackAgentRun(record, getRuntime(), !privateSession);
        useChatStore.setState({ latestAgentRun: updated });
      },
    );
  };

  if (!workspace) return null;

  const commands = toolCalls.filter((c) => c.toolName === "run_command");
  const failed = toolResults.filter((r) => !r.success);
  const statusLabel = t(`agent.runStatus.${record.status}`);
  const summaryIcon =
    record.status === "completed" ? (
      <CheckCircle2 size={15} />
    ) : record.status === "cancelled" || record.status === "rolled_back" ? (
      <CircleSlash2 size={15} />
    ) : (
      <AlertTriangle size={15} />
    );
  const openDiff = (path: string) => {
    openResource({ kind: "diff", path, runId: record.id });
  };
  const openOutput = (output: TaskOutput) => {
    if (output.kind === "screenshot") {
      openResource({ kind: "screenshot", path: output.path });
    } else {
      openResource({
        kind: "file",
        path: output.path,
        ...(output.mimeType ? { mimeType: output.mimeType } : {}),
      });
    }
  };

  return (
    <details
      className={`agent-run-summary result-summary${embedded ? " agent-run-summary-embedded" : ""}`}
      open={embedded || undefined}
    >
      <summary className="summary-header">
        <span className={`summary-state summary-state-${record.status}`} aria-hidden="true">
          {summaryIcon}
        </span>
        <div>
          <span className="summary-eyebrow">{statusLabel}</span>
          <h3>{t("agent.runSummary")}</h3>
        </div>
        <span className="summary-metrics">
          {t("agent.filesModified")} {changes.length}
          {outputs.length > 0 && ` · ${t("workspace.outputsCount", { count: outputs.length })}`}
          {record.durationMs !== undefined &&
            ` · ${t("agent.duration")} ${(record.durationMs / 1000).toFixed(1)}s`}
        </span>
        {maxIterationsReached && (
          <span className="summary-warning">
            <AlertTriangle size={14} />
            {t("agent.maxIterations")}
          </span>
        )}
        <ChevronRight className="summary-chevron" size={15} aria-hidden="true" />
      </summary>
      <div className="agent-run-details">
        <div className="result-summary-actions">
          {outputs.length > 0 && (
            <button
              type="button"
              className="primary-button result-view-outputs"
              onClick={() => openPanel("outputs")}
            >
              <PackageOpen size={14} aria-hidden="true" />
              {t("workspace.viewOutputs")}
            </button>
          )}
          {changes.length > 0 && record.status !== "rolled_back" && (
            <button
              type="button"
              className="primary-button result-review-changes"
              onClick={() => openPanel("changes")}
            >
              <GitCompareArrows size={14} aria-hidden="true" />
              {t("workspace.reviewChanges")}
            </button>
          )}
          {snapshots.length > 0 && record.status !== "rolled_back" && (
            <button
              type="button"
              className="quiet-danger-button summary-rollback"
              onClick={requestRollback}
            >
              <RotateCcw size={14} />
              {t("agent.rollback")}
            </button>
          )}
        </div>

        <div className="summary-section">
          <h4>
            <FileCode2 size={15} />
            {t("workspace.changesTitle")}
            <span>{changes.length}</span>
            {diffStats && (
              <em className="result-diffstats">
                +{diffStats.additions} −{diffStats.deletions}
              </em>
            )}
          </h4>
          {changes.length === 0 ? (
            <p className="summary-empty">{t("agent.none")}</p>
          ) : (
            <ul className="result-change-list">
              {changes.map((change) => (
                <li key={change.path}>
                  <button
                    type="button"
                    onClick={() => openDiff(change.path)}
                    data-tip={change.path}
                  >
                    <span className={`workspace-change-letter ${change.changeType}`}>
                      {change.changeType === "added" ? "A" : "M"}
                    </span>
                    {change.changeType === "added" ? (
                      <FilePlus2 size={13} aria-hidden="true" />
                    ) : (
                      <FileCode2 size={13} aria-hidden="true" />
                    )}
                    <code>{relativeToRoot(change.path, workspace)}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {outputs.length > 0 && (
          <div className="summary-section">
            <h4>
              <ImageIcon size={15} />
              {t("workspace.outputsTitle")}
              <span>{outputs.length}</span>
            </h4>
            <ul className="result-change-list">
              {outputs.map((output) => (
                <li key={output.id}>
                  <button type="button" onClick={() => openOutput(output)} data-tip={output.path}>
                    <span className="workspace-output-type">{output.type}</span>
                    <code>{relativeToRoot(output.path, workspace)}</code>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(record.verificationEvidence.length > 0 || verification) && (
          <div className="summary-section">
            <h4>
              <CheckCircle2 size={15} />
              {t("agent.verification")}
            </h4>
            <ul className="result-verification-list">
              {record.verificationEvidence.map((evidence, index) => (
                <li key={`${evidence.type}:${index}`}>
                  {evidence.success ? (
                    <CheckCircle2 size={13} className="result-ok" />
                  ) : (
                    <XCircle size={13} className="result-fail" />
                  )}
                  <span>{evidence.summary}</span>
                </li>
              ))}
              {verification && record.verificationEvidence.length === 0 && (
                <li>
                  {verification.status === "passed" ? (
                    <CheckCircle2 size={13} className="result-ok" />
                  ) : (
                    <XCircle size={13} className="result-fail" />
                  )}
                  <span>
                    {verification.command}: {verification.status}
                    {verification.exitCode !== null ? ` (exit ${verification.exitCode})` : ""}
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}

        <details className="result-more-details">
          <summary>
            {t("agent.detailedEvidence")}
            <ChevronRight size={14} aria-hidden="true" />
          </summary>

          {toolResults.length > 0 && (
            <div className="summary-section">
              <h4>
                <Clock3 size={15} />
                {t("agent.toolExecutions")}
                <span>{toolResults.length}</span>
              </h4>
              <ul>
                {toolResults.map((result) => (
                  <li key={result.toolCallId}>
                    <code>{result.toolName}</code>
                    {` · ${result.success ? t("tools.success") : t("tools.failed")}`}
                    {result.durationMs !== undefined && ` · ${result.durationMs}ms`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {commands.length > 0 && (
            <div className="summary-section">
              <h4>
                <TerminalSquare size={15} />
                {t("agent.commandsRun")}
                <span>{commands.length}</span>
              </h4>
              <ul>
                {commands.map((c, i) => {
                  const idx = toolCalls.indexOf(c);
                  const r = idx >= 0 ? toolResults[idx] : undefined;
                  return (
                    <li key={i}>
                      <code>
                        {String(c.arguments.program)}{" "}
                        {Array.isArray(c.arguments.args)
                          ? (c.arguments.args as string[]).join(" ")
                          : ""}
                      </code>
                      {r && (
                        <span
                          className={r.success ? "result-ok" : "result-fail"}
                          aria-label={r.success ? t("tools.success") : t("tools.failed")}
                        >
                          {r.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {gitInfo?.isRepo && diff && diff !== "no changes" && (
            <div className="summary-section">
              <h4>
                <GitCompareArrows size={15} />
                {t("agent.gitChanges")}
                <span>{gitInfo.branch}</span>
              </h4>
              <details>
                <summary>
                  {t("agent.filesChanged", { count: gitInfo.entries.length })}
                  <ChevronRight size={14} />
                </summary>
                <pre className="git-diff-preview">{diff.slice(0, 3000)}</pre>
              </details>
            </div>
          )}

          {failed.length > 0 && (
            <div className="summary-section summary-errors">
              <h4>
                <AlertTriangle size={15} />
                {t("agent.unresolvedErrors")}
                <span>{failed.length}</span>
              </h4>
              <ul>
                {failed.map((r, i) => (
                  <li key={i}>
                    {r.error}: {r.output.slice(0, 200)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>

        {loading && (
          <p className="summary-loading">
            <LoaderCircle size={14} />
            {t("agent.loading")}
          </p>
        )}
      </div>
      {confirmationDialog}
    </details>
  );
}
