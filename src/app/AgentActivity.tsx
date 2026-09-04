import { deriveToolStatus } from "../features/chat/tool-view-model";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FilePenLine,
  Globe,
  ShieldAlert as ShieldAlertIcon,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationTitle,
  ToolGroupCalls,
  ToolGroupHeader,
  ToolRow,
  ToolTimeline,
  type ToolStatus,
} from "../components/ai";
import { Badge } from "../components/ui";
import { cn } from "../components/ui/utils";
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

const ACTIVITY_BADGE: Record<string, string> = {
  running: "border-primary/30 bg-primary/[0.07] text-primary",
  approval: "border-warning/40 bg-warning/[0.09] text-warning",
  cancelled: "border-border bg-surface-hover text-muted",
  denied: "border-danger/30 bg-danger/[0.05] text-danger/90",
  failed: "border-danger/35 bg-danger/[0.07] text-danger",
  complete: "border-success/30 bg-success/[0.07] text-success",
};

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
  const conversationMessages = useChatStore((state) => state.messages) ?? [];
  const resultsByCallId = new Map(toolResults.map((result) => [result.toolCallId, result]));
  const approvalArguments = pendingApproval ? JSON.stringify(pendingApproval.args) : "";

  // §Approval resolved state: the actionable card exists ONLY while this
  // message's permission request is the conversation's active pending
  // approval (toolCallIds are unique per conversation). Historical
  // permission requests derive their resolution from the conversation's
  // persisted records and render read-only — never a stale actionable card.
  const callsById = new Set(toolCalls.map(({ id }) => id));
  const isActivePending = pendingApproval !== null && callsById.has(pendingApproval.toolCallId);
  const resolvedState = new Map<string, "approved" | "denied">();
  for (const message of conversationMessages) {
    for (const result of message.toolResults ?? []) {
      if (!callsById.has(result.toolCallId)) continue;
      if (result.error === TOOL_PERMISSION_REQUIRED) continue;
      resolvedState.set(result.toolCallId, result.error === TOOL_DENIED ? "denied" : "approved");
    }
  }

  const groups = groupToolCalls(toolCalls, toolResults);
  // §Approval resolved state: a permission request whose call was executed in
  // a later message (approved) or denied is RESOLVED — the group badge must
  // not keep the waiting appearance after the decision.
  const completed = toolCalls.filter((call) => {
    const result = resultsByCallId.get(call.id);
    if (result && result.error !== TOOL_PERMISSION_REQUIRED) return true;
    return resolvedState.get(call.id) === "approved";
  }).length;
  const hasDenied = toolCalls.some((call) => resolvedState.get(call.id) === "denied");
  const hasPending = toolCalls.some((call) => {
    if (resultsByCallId.get(call.id)?.error !== TOOL_PERMISSION_REQUIRED) return false;
    if (isActivePending && pendingApproval?.toolCallId === call.id) return true;
    return !resolvedState.has(call.id);
  });
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
            : hasDenied
              ? "denied"
              : completed < toolCalls.length
                ? "cancelled"
                : "complete";
  const statusLabel =
    status === "approval"
      ? t("tools.waitingApproval")
      : status === "denied"
        ? t("tools.permissionDenied")
        : status === "running"
          ? t("agent.processing")
          : status === "cancelled"
            ? t("chat.stopped")
            : status === "failed"
              ? t("agent.completedWithErrors")
              : t("agent.completed");

  return (
    <section
      className={`agent-activity agent-activity-${status} mt-1 flex min-w-0 flex-col gap-0.5`}
      aria-label={t("tools.title")}
    >
      <button
        type="button"
        className={cn(
          "activity-header flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-left transition-colors select-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
          ACTIVITY_BADGE[status],
        )}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <strong className="text-[12px] font-semibold">{statusLabel}</strong>
        <span className="text-[11px] font-normal opacity-85">
          {t("tools.progress", { completed, total: toolCalls.length })}
          {failedRetryCount ? ` · ${t("tools.retriedTimes", { count: failedRetryCount })}` : ""}
        </span>
      </button>

      <ToolTimeline className="execution-timeline tool-groups">
        {groups.map((group, groupIndex) => {
          const summary = groupSummary(group);
          const groupOpen = expanded || expandedGroups[groupIndex] === true;
          const runningCount = group.calls.filter(({ result }) => !result).length;
          const failedCount = group.calls.filter(
            ({ result }) => result && !result.success && result.error !== TOOL_PERMISSION_REQUIRED,
          ).length;
          return (
            <div key={groupIndex} className={`tool-group tool-group-${group.kind}`}>
              <ToolGroupHeader
                open={groupOpen}
                icon={runningCount > 0 ? <LoaderSpinner /> : <GroupIcon kind={group.kind} />}
                summary={t(summary.labelKey, { ...summary.values })}
                meta={
                  failedCount > 0 ? (
                    <span className="text-danger/90">
                      {" "}
                      · {t("tools.failedCount", { count: failedCount })}
                    </span>
                  ) : undefined
                }
                onClick={() =>
                  setExpandedGroups((current) => ({
                    ...current,
                    [groupIndex]: !(current[groupIndex] === true),
                  }))
                }
              />
              {groupOpen && (
                <ToolGroupCalls>
                  {group.calls.map(({ call, result }) => {
                    let toolStatus: ToolStatus = deriveToolStatus(call, result, isStreaming);
                    const permissionRow =
                      toolStatus === "waiting-approval" &&
                      (!isActivePending || pendingApproval?.toolCallId !== call.id);
                    let resolvedLabel: string | null = null;
                    if (permissionRow) {
                      // Historical permission request: show its resolution.
                      resolvedLabel =
                        resolvedState.get(call.id) === "denied"
                          ? t("tools.permissionDenied")
                          : t("tools.permissionApproved");
                      toolStatus = resolvedState.get(call.id) === "denied" ? "denied" : "completed";
                    }
                    const toolKey = `tools.${call.toolName}`;
                    const toolName = i18n.exists(toolKey) ? t(toolKey) : call.toolName;
                    const summaryText = getArgumentSummary(call);
                    const statusLabelRow = toolStatusLabel(toolStatus, t, result);
                    return (
                      <ToolRow
                        key={call.id}
                        status={toolStatus}
                        name={toolName}
                        detail={summaryText}
                        detailTitle={summaryText}
                        statusLabel={
                          <>
                            {resolvedLabel ?? statusLabelRow}
                            {result?.durationMs !== undefined &&
                              ` · ${(result.durationMs / 1000).toFixed(1)}s`}
                          </>
                        }
                      />
                    );
                  })}
                </ToolGroupCalls>
              )}
            </div>
          );
        })}
      </ToolTimeline>

      {hasPending && isActivePending && pendingApproval && (
        <Confirmation
          className="approval-panel mt-1 gap-0 border-warning/45"
          state="approval-requested"
          approval={{ id: pendingApproval.toolCallId }}
        >
          <div className="flex items-start gap-2.5 px-3.5 pt-3">
            <span
              className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning"
              aria-hidden="true"
            >
              <ShieldAlertIcon />
            </span>
            <div className="min-w-0">
              <ConfirmationTitle className="!text-foreground">
                <strong className="text-[13px] font-semibold">{t("tools.approvalTitle")}</strong>
              </ConfirmationTitle>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                {t("tools.approvalDescription")}
              </p>
            </div>
          </div>
          <dl className="approval-facts grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3.5 pb-3 text-[11.5px]">
            <div className="contents">
              <dt className="text-muted">{t("tools.approvalTool")}</dt>
              <dd className="min-w-0 break-all font-medium text-foreground/90">
                {pendingApproval.toolName}
              </dd>
            </div>
            {pendingApproval.riskLevel && (
              <div className="contents">
                <dt className="text-muted">{t("tools.approvalRisk")}</dt>
                <dd className="min-w-0 break-all font-medium text-foreground/90">
                  <Badge variant="warning" className="px-1.5 text-[10.5px]">
                    {pendingApproval.riskLevel}
                  </Badge>
                </dd>
              </div>
            )}
            {pendingApproval.approval?.target && (
              <div className="contents">
                <dt className="text-muted">{t("tools.approvalTarget")}</dt>
                <dd className="min-w-0 break-all font-medium text-foreground/90">
                  {pendingApproval.approval.target}
                </dd>
              </div>
            )}
            {pendingApproval.approval?.dataDestination && (
              <div className="contents">
                <dt className="text-muted">{t("tools.dataDestination")}</dt>
                <dd className="min-w-0 break-all font-medium text-foreground/90">
                  {pendingApproval.approval.dataDestination}
                </dd>
              </div>
            )}
            {pendingApproval.approval?.impact && (
              <div className="contents">
                <dt className="text-muted">{t("tools.approvalImpact")}</dt>
                <dd className="min-w-0 break-all font-medium text-foreground/90">
                  {t(`tools.approvalImpacts.${pendingApproval.approval.impact}`)}
                </dd>
              </div>
            )}
            {pendingApproval.approval && (
              <div className="contents">
                <dt className="text-muted">{t("tools.reversible")}</dt>
                <dd className="min-w-0 break-all font-medium text-foreground/90">
                  {pendingApproval.approval.reversible ? t("common.yes") : t("common.no")}
                </dd>
              </div>
            )}
            <div className="contents">
              <dt className="text-muted">{t("tools.arguments")}</dt>
              <dd className="min-w-0 break-all font-mono text-[11px] text-muted">
                {approvalArguments.slice(0, 500)}
                {approvalArguments.length > 500 ? "…" : ""}
              </dd>
            </div>
          </dl>
          <ConfirmationActions className="border-t border-border px-3.5 pb-3 pt-2.5">
            <ConfirmationAction
              variant="outline"
              disabled={isApprovalConversationStreaming}
              onClick={() => void denyTool()}
            >
              {t("tools.deny")}
            </ConfirmationAction>
            <ConfirmationAction
              variant="primary"
              disabled={isApprovalConversationStreaming}
              onClick={() => void approveTool()}
            >
              {t("tools.approveOnce")}
            </ConfirmationAction>
          </ConfirmationActions>
        </Confirmation>
      )}

      {expanded && (
        <div className="execution-details mt-1 flex flex-col gap-1">
          {toolCalls.map((call) => {
            const result = resultsByCallId.get(call.id);
            const resultText =
              result?.error === TOOL_NOT_AVAILABLE ? t("tools.notAvailable") : result?.output;
            return (
              <details
                key={call.id}
                className="rounded-lg border border-border bg-surface-subtle px-2.5 py-1.5 text-[12px]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 text-muted select-none [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-foreground/90">{call.toolName}</span>
                  <span className="text-[11px]">{t("tools.inspectStep")}</span>
                </summary>
                <div className="execution-detail-grid mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <span className="mb-1 block text-[11px] text-muted">
                      {t("tools.arguments")}
                    </span>
                    <pre className="max-h-56 overflow-auto rounded-md bg-surface-hover p-2 font-mono text-[11px] whitespace-pre-wrap">
                      {JSON.stringify(call.arguments, null, 2)}
                    </pre>
                  </div>
                  {result && (
                    <div>
                      <span className="mb-1 block text-[11px] text-muted">{t("tools.result")}</span>
                      <pre className="max-h-56 overflow-auto rounded-md bg-surface-hover p-2 font-mono text-[11px] whitespace-pre-wrap">
                        {resultText}
                      </pre>
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

function LoaderSpinner() {
  return (
    <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function toolStatusLabel(
  status: ToolStatus,
  t: (key: string) => string,
  result: ToolResultRecord | undefined,
): string {
  switch (status) {
    case "running":
      return t("tools.executing");
    case "waiting-approval":
      return t("tools.permissionRequired");
    case "denied":
      return t("tools.denied");
    case "completed":
      return t("tools.success");
    case "failed":
      return t("tools.failed");
    default:
      return result ? t("tools.failed") : t("tools.queued");
  }
}
