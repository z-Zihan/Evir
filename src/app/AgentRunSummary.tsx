import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
    <div className="agent-run-summary">
      <div className="summary-header">
        <h3>{t("agent.runSummary")}</h3>
        {maxIterationsReached && (
          <span className="summary-warning">⚠️ {t("agent.maxIterations")}</span>
        )}
      </div>

      <div className="summary-section">
        <h4>
          {t("agent.filesModified")} ({fileModifications.length})
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
            {t("agent.commandsRun")} ({commands.length})
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
                    <span className={r.success ? "result-ok" : "result-fail"}>
                      {r.success ? " ✅" : " ❌"}
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
          <h4>{t("agent.verification")}</h4>
          <div className={`verification-result verification-${verification.status}`}>
            <span className="verification-status">
              {verification.status === "passed"
                ? "✅"
                : verification.status === "failed"
                  ? "❌"
                  : "⏭️"}{" "}
              {verification.command}
            </span>
            {verification.exitCode !== null && (
              <span className="verification-exit">exit: {verification.exitCode}</span>
            )}
            <span className="verification-time">
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
          <h4>Git Diff ({gitInfo.branch})</h4>
          <details>
            <summary>{gitInfo.entries.length} files changed</summary>
            <pre className="git-diff-preview">{diff.slice(0, 3000)}</pre>
          </details>
        </div>
      )}

      {failed.length > 0 && (
        <div className="summary-section summary-errors">
          <h4>
            ⚠️ {t("agent.unresolvedErrors")} ({failed.length})
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

      {loading && <p className="summary-loading">{t("agent.loading")}...</p>}
    </div>
  );
}
