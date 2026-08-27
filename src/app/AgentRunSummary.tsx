import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Clock3,
  FileCode2,
  GitCompareArrows,
  LoaderCircle,
  RotateCcw,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { useWorkspaceStore } from "../features/workspace/workspace-store";
import { getRuntime } from "../runtime/use-runtime";
import {
  runVerification,
  getGitDiff,
  getGitStatus,
  type VerificationResult,
} from "../core/tools/verification";
import {
  applyAutomaticVerification,
  persistAgentRun,
  rollbackAgentRun,
  type AgentRunRecord,
} from "../features/chat/agent-run-record";
import { useChatStore } from "../features/chat/chat-store";
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

export function AgentRunSummary({
  record,
  onLayoutChange,
  embedded = false,
}: AgentRunSummaryProps) {
  const { t } = useTranslation();
  const { id: runId, toolCalls, toolResults, maxIterationsReached, snapshots } = record;
  const workspace = useWorkspaceStore((s) => s.currentWorkspace);
  const privateSession = useChatStore((state) => state.privateSession);
  const { requestConfirmation, confirmationDialog } = useConfirmationDialog();
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onLayoutChange?.();
  }, [verification, diff, gitInfo, loading, onLayoutChange]);

  useEffect(() => {
    if (
      !workspace ||
      record.verificationEvidence.some(({ summary }) => summary.startsWith("automatic:"))
    )
      return;
    const runtime = getRuntime();
    setLoading(true);
    void Promise.all([
      runVerification(workspace, runtime),
      getGitDiff(workspace, runtime),
      getGitStatus(workspace, runtime),
    ]).then(async ([v, d, g]) => {
      setVerification(v);
      setDiff(d);
      setGitInfo(g);
      setLoading(false);
      const updated = applyAutomaticVerification(record, v);
      if (updated !== record) {
        useChatStore.setState((state) =>
          state.latestAgentRun?.id === updated.id ? { latestAgentRun: updated } : {},
        );
        if (!privateSession) await persistAgentRun(updated);
      }
    });
  }, [workspace, runId, record, privateSession, onLayoutChange]);

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

  const fileModifications = toolCalls.filter((c) =>
    ["write_file", "apply_patch", "create_directory"].includes(c.toolName),
  );
  const commands = toolCalls.filter((c) => c.toolName === "run_command");
  const failed = toolResults.filter((r) => !r.success);
  const summaryIcon =
    record.status === "completed" ? (
      <CheckCircle2 size={15} />
    ) : record.status === "cancelled" || record.status === "rolled_back" ? (
      <CircleSlash2 size={15} />
    ) : (
      <AlertTriangle size={15} />
    );

  return (
    <details
      className={`agent-run-summary${embedded ? " agent-run-summary-embedded" : ""}`}
      open={embedded || undefined}
    >
      <summary className="summary-header">
        <span className={`summary-state summary-state-${record.status}`} aria-hidden="true">
          {summaryIcon}
        </span>
        <div>
          <span className="summary-eyebrow">{t("agent.evidence")}</span>
          <h3>{t("agent.runSummary")}</h3>
        </div>
        <span className="summary-metrics">
          {t("agent.filesModified")} {fileModifications.length}
          {commands.length > 0 && ` · ${t("agent.commandsRun")} ${commands.length}`}
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

        <div className="summary-section">
          <h4>
            <FileCode2 size={15} />
            {t("agent.filesModified")}
            <span>{fileModifications.length}</span>
          </h4>
          {fileModifications.length === 0 ? (
            <p className="summary-empty">{t("agent.none")}</p>
          ) : (
            <ul>
              {fileModifications.map((c, i) => (
                <li key={i}>
                  <code>{c.toolName}</code>:{" "}
                  {typeof (c.arguments.path ?? c.arguments.file_path) === "string"
                    ? ((c.arguments.path ?? c.arguments.file_path) as string)
                    : "?"}
                </li>
              ))}
            </ul>
          )}
        </div>

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

        {verification && (
          <div className="summary-section">
            <h4>
              <CheckCircle2 size={15} />
              {t("agent.verification")}
            </h4>
            <div className={`verification-result verification-${verification.status}`}>
              <span className="verification-status">
                {verification.status === "passed" ? (
                  <CheckCircle2 size={15} />
                ) : verification.status === "failed" ? (
                  <XCircle size={15} />
                ) : (
                  <CircleSlash2 size={15} />
                )}{" "}
                {verification.command}
              </span>
              {verification.exitCode !== null && (
                <span className="verification-exit">exit: {verification.exitCode}</span>
              )}
              <span className="verification-time">
                <Clock3 size={13} />
                {(verification.durationMs / 1000).toFixed(1)}s
              </span>
              {verification.stderrPreview && (
                <pre className="verification-output">
                  {verification.stderrPreview.slice(0, 500)}
                </pre>
              )}
            </div>
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
