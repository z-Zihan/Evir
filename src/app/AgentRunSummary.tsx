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

interface AgentRunSummaryProps {
  runId: string;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  toolResults: Array<{ success: boolean; output: string; error?: string }>;
  maxIterationsReached: boolean;
}

interface GitInfo {
  isRepo: boolean;
  entries: Array<{ status: string; file: string }>;
  branch: string | null;
}

export function AgentRunSummary({
  runId,
  toolCalls,
  toolResults,
  maxIterationsReached,
}: AgentRunSummaryProps) {
  const { t } = useTranslation();
  const workspace = useWorkspaceStore((s) => s.currentWorkspace);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const runtime = getRuntime();
    setLoading(true);
    void Promise.all([
      runVerification(workspace, runtime),
      getGitDiff(workspace, runtime),
      getGitStatus(workspace, runtime),
    ]).then(([v, d, g]) => {
      setVerification(v);
      setDiff(d);
      setGitInfo(g);
      setLoading(false);
    });
  }, [workspace, runId]);

  if (!workspace) return null;

  const fileModifications = toolCalls.filter((c) =>
    ["write_file", "apply_patch", "create_directory"].includes(c.toolName),
  );
  const commands = toolCalls.filter((c) => c.toolName === "run_command");
  const failed = toolResults.filter((r) => !r.success);

  return (
    <section className="agent-run-summary">
      <div className="summary-header">
        <div>
          <span className="summary-eyebrow">{t("agent.evidence")}</span>
          <h3>{t("agent.runSummary")}</h3>
        </div>
        {maxIterationsReached && (
          <span className="summary-warning">
            <AlertTriangle size={14} />
            {t("agent.maxIterations")}
          </span>
        )}
      </div>

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
                {typeof (c.args.path ?? c.args.file_path) === "string"
                  ? ((c.args.path ?? c.args.file_path) as string)
                  : "?"}
              </li>
            ))}
          </ul>
        )}
      </div>

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
                    {String(c.args.program)}{" "}
                    {Array.isArray(c.args.args) ? (c.args.args as string[]).join(" ") : ""}
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
              <pre className="verification-output">{verification.stderrPreview.slice(0, 500)}</pre>
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
    </section>
  );
}
