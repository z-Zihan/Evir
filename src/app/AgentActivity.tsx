import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleSlash2,
  LoaderCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MessageRecord, ToolCallRecord, ToolResultRecord } from "../core/storage/db";
import {
  TOOL_DENIED,
  TOOL_NOT_AVAILABLE,
  TOOL_PERMISSION_REQUIRED,
} from "../core/tools/tool-executor";
import { useChatStore } from "../features/chat/chat-store";

interface AgentActivityProps {
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  messageStatus: MessageRecord["status"];
  /** 连续相同失败重试被渲染层折叠时，附加到首条卡片的次数 */
  failedRetryCount?: number | undefined;
}

function getArgumentSummary(call: ToolCallRecord): string {
  const path = call.arguments["path"] ?? call.arguments["file_path"];
  if (typeof path === "string") return path.split("/").slice(-2).join("/");

  const program = call.arguments["program"];
  const args = call.arguments["args"];
  if (typeof program === "string") {
    return [
      program,
      ...(Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : []),
    ].join(" ");
  }
  return "";
}

export function AgentActivity({
  toolCalls,
  toolResults,
  messageStatus,
  failedRetryCount,
}: AgentActivityProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isStreaming = useChatStore((state) => state.isStreaming);
  // Approve/deny belong to THIS conversation's pending approval; a stream
  // running in another conversation must not disable them.
  const isApprovalConversationStreaming = useChatStore(
    (state) =>
      state.isStreaming &&
      state.pendingToolApproval !== null &&
      state.activeStreamConversationId === state.pendingToolApproval.conversationId,
  );
  const approveTool = useChatStore((state) => state.approveTool);
  const denyTool = useChatStore((state) => state.denyTool);
  const pendingApproval = useChatStore((state) => state.pendingToolApproval);
  const resultsByCallId = new Map(toolResults.map((result) => [result.toolCallId, result]));
  const approvalArguments = pendingApproval ? JSON.stringify(pendingApproval.args) : "";

  const completed = toolCalls.filter((call) => {
    const result = resultsByCallId.get(call.id);
    return result && result.error !== TOOL_PERMISSION_REQUIRED;
  }).length;
  const hasPending = toolCalls.some(
    (call) => resultsByCallId.get(call.id)?.error === TOOL_PERMISSION_REQUIRED,
  );
  const hasFailed = toolResults.some(
    (result) =>
      !result.success && result.error !== TOOL_PERMISSION_REQUIRED && result.error !== TOOL_DENIED,
  );
  const status =
    messageStatus === "stopped"
      ? "cancelled"
      : hasPending
        ? "approval"
        : isStreaming && completed < toolCalls.length
          ? "running"
          : hasFailed || messageStatus === "error"
            ? "failed"
            : completed < toolCalls.length
              ? "cancelled"
              : "complete";
  const statusLabel =
    status === "approval"
      ? t("tools.waitingApproval")
      : status === "running"
        ? t("agent.processing")
        : status === "cancelled"
          ? t("chat.stopped")
          : status === "failed"
            ? t("agent.completedWithErrors")
            : t("agent.completed");

  return (
    <section className={`agent-activity agent-activity-${status}`} aria-label={t("tools.title")}>
      <button
        type="button"
        className="activity-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="activity-state-icon" aria-hidden="true">
          {status === "running" ? (
            <LoaderCircle size={15} />
          ) : status === "approval" ? (
            <ShieldAlert size={15} />
          ) : status === "cancelled" ? (
            <CircleSlash2 size={15} />
          ) : status === "failed" ? (
            <XCircle size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
        </span>
        <span className="activity-heading-copy">
          <strong>{statusLabel}</strong>
          <span>
            {t("tools.progress", { completed, total: toolCalls.length })}
            {failedRetryCount ? ` · ${t("tools.retriedTimes", { count: failedRetryCount })}` : ""}
          </span>
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      <div className="execution-timeline">
        {(expanded ? toolCalls : toolCalls.slice(-3)).map((call) => {
          const result = resultsByCallId.get(call.id);
          const permissionRequired = result?.error === TOOL_PERMISSION_REQUIRED;
          const running = isStreaming && !result;
          const denied = result?.error === TOOL_DENIED;
          const toolKey = `tools.${call.toolName}`;
          const toolName = i18n.exists(toolKey) ? t(toolKey) : call.toolName;
          const summary = getArgumentSummary(call);

          return (
            <div
              key={call.id}
              className={`execution-step${running ? " is-running" : ""}${permissionRequired ? " is-pending" : ""}`}
            >
              <span className="execution-marker" aria-hidden="true">
                {running ? (
                  <LoaderCircle size={13} />
                ) : permissionRequired ? (
                  <ShieldAlert size={13} />
                ) : result?.success ? (
                  <CheckCircle2 size={13} />
                ) : denied ? (
                  <Circle size={13} />
                ) : result ? (
                  <XCircle size={13} />
                ) : (
                  <CircleDashed size={13} />
                )}
              </span>
              <span className="execution-copy">
                <strong>{toolName}</strong>
                {summary && <span title={summary}>{summary}</span>}
              </span>
              <span className="execution-status">
                {running
                  ? t("tools.executing")
                  : permissionRequired
                    ? t("tools.permissionRequired")
                    : denied
                      ? t("tools.denied")
                      : result?.success
                        ? t("tools.success")
                        : result
                          ? t("tools.failed")
                          : t("tools.queued")}
                {result?.durationMs !== undefined && ` · ${(result.durationMs / 1000).toFixed(1)}s`}
              </span>
            </div>
          );
        })}
      </div>

      {!expanded && toolCalls.length > 3 && (
        <button type="button" className="activity-more" onClick={() => setExpanded(true)}>
          {t("tools.showMore", { count: toolCalls.length - 3 })}
        </button>
      )}

      {hasPending && (
        <div className="approval-panel">
          <ShieldAlert size={18} aria-hidden="true" />
          <div className="approval-copy">
            <strong>{t("tools.approvalTitle")}</strong>
            <p>{t("tools.approvalDescription")}</p>
            {pendingApproval && (
              <dl className="approval-facts">
                <div>
                  <dt>{t("tools.approvalTool")}</dt>
                  <dd>{pendingApproval.toolName}</dd>
                </div>
                {pendingApproval.riskLevel && (
                  <div>
                    <dt>{t("tools.approvalRisk")}</dt>
                    <dd>{pendingApproval.riskLevel}</dd>
                  </div>
                )}
                {pendingApproval.approval?.target && (
                  <div>
                    <dt>{t("tools.approvalTarget")}</dt>
                    <dd>{pendingApproval.approval.target}</dd>
                  </div>
                )}
                {pendingApproval.approval?.dataDestination && (
                  <div>
                    <dt>{t("tools.dataDestination")}</dt>
                    <dd>{pendingApproval.approval.dataDestination}</dd>
                  </div>
                )}
                {pendingApproval.approval?.impact && (
                  <div>
                    <dt>{t("tools.approvalImpact")}</dt>
                    <dd>{t(`tools.approvalImpacts.${pendingApproval.approval.impact}`)}</dd>
                  </div>
                )}
                {pendingApproval.approval && (
                  <div>
                    <dt>{t("tools.reversible")}</dt>
                    <dd>
                      {pendingApproval.approval.reversible ? t("common.yes") : t("common.no")}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t("tools.arguments")}</dt>
                  <dd>
                    {approvalArguments.slice(0, 500)}
                    {approvalArguments.length > 500 ? "…" : ""}
                  </dd>
                </div>
              </dl>
            )}
          </div>
          <div className="approval-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={isApprovalConversationStreaming}
              onClick={() => void denyTool()}
            >
              {t("tools.deny")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={isApprovalConversationStreaming}
              onClick={() => void approveTool()}
            >
              {t("tools.approveOnce")}
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="execution-details">
          {toolCalls.map((call) => {
            const result = resultsByCallId.get(call.id);
            const resultText =
              result?.error === TOOL_NOT_AVAILABLE ? t("tools.notAvailable") : result?.output;
            return (
              <details key={call.id}>
                <summary>
                  <span>{call.toolName}</span>
                  <span>{t("tools.inspectStep")}</span>
                </summary>
                <div className="execution-detail-grid">
                  <div>
                    <span>{t("tools.arguments")}</span>
                    <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                  </div>
                  {result && (
                    <div>
                      <span>{t("tools.result")}</span>
                      <pre>{resultText}</pre>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
