import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleSlash2,
  Eye,
  FilePenLine,
  Globe,
  LoaderCircle,
  ShieldAlert,
  SquareTerminal,
  Wrench,
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
import { groupSummary, groupToolCalls, type ToolGroupKind } from "./agent-activity-groups";

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

  // Browser tools: surface the URL / ref / key the agent acted on.
  if (call.toolName.startsWith("browser_")) {
    const url = call.arguments["url"];
    if (typeof url === "string") return url.replace(/^https?:\/\//, "").slice(0, 60);
    const elementRef = call.arguments["element_ref"];
    if (typeof elementRef === "string") {
      const text = call.arguments["text"] ?? call.arguments["value"];
      return typeof text === "string" ? `${elementRef} → ${text.slice(0, 24)}` : elementRef;
    }
    const key = call.arguments["key"] ?? call.arguments["direction"] ?? call.arguments["target_id"];
    if (typeof key === "string") return key;
  }
  return "";
}

function GroupIcon({ kind }: { kind: ToolGroupKind }) {
  switch (kind) {
    case "inspect":
      return <Eye size={14} aria-hidden="true" />;
    case "change":
      return <FilePenLine size={14} aria-hidden="true" />;
    case "command":
      return <SquareTerminal size={14} aria-hidden="true" />;
    case "browser":
      return <Globe size={14} aria-hidden="true" />;
    default:
      return <Wrench size={14} aria-hidden="true" />;
  }
}

export function AgentActivity({
  toolCalls,
  toolResults,
  messageStatus,
  failedRetryCount,
}: AgentActivityProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
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

  const groups = groupToolCalls(toolCalls, toolResults);
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

      <div className="execution-timeline tool-groups">
        {groups.map((group, groupIndex) => {
          const summary = groupSummary(group);
          const groupOpen = expanded || expandedGroups[groupIndex] === true;
          const runningCount = group.calls.filter(({ result }) => !result).length;
          const failedCount = group.calls.filter(
            ({ result }) => result && !result.success && result.error !== TOOL_PERMISSION_REQUIRED,
          ).length;
          return (
            <div key={groupIndex} className={`tool-group tool-group-${group.kind}`}>
              <button
                type="button"
                className="tool-group-header"
                onClick={() =>
                  setExpandedGroups((current) => ({
                    ...current,
                    [groupIndex]: !(current[groupIndex] === true),
                  }))
                }
                aria-expanded={groupOpen}
              >
                <span className="tool-group-icon" aria-hidden="true">
                  {runningCount > 0 ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <GroupIcon kind={group.kind} />
                  )}
                </span>
                <span className="tool-group-copy">
                  {t(summary.labelKey, { ...summary.values })}
                  {failedCount > 0 && (
                    <span className="tool-group-failed">
                      {" "}
                      · {t("tools.failedCount", { count: failedCount })}
                    </span>
                  )}
                </span>
                {groupOpen ? (
                  <ChevronDown size={13} aria-hidden="true" />
                ) : (
                  <ChevronRight size={13} aria-hidden="true" />
                )}
              </button>
              {groupOpen && (
                <div className="tool-group-calls">
                  {group.calls.map(({ call, result }) => {
                    const permissionRequired = result?.error === TOOL_PERMISSION_REQUIRED;
                    const running = isStreaming && !result;
                    const denied = result?.error === TOOL_DENIED;
                    const toolKey = `tools.${call.toolName}`;
                    const toolName = i18n.exists(toolKey) ? t(toolKey) : call.toolName;
                    const summaryText = getArgumentSummary(call);
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
                          {summaryText && <span data-tip={summaryText}>{summaryText}</span>}
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
                          {result?.durationMs !== undefined &&
                            ` · ${(result.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
