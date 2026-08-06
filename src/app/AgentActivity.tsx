import { useState } from "react";
import { ChevronDown, ChevronRight, Circle, Check, X, Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolCallRecord, ToolResultRecord } from "../core/storage/db";
import {
  TOOL_DENIED,
  TOOL_NOT_AVAILABLE,
  TOOL_PERMISSION_REQUIRED,
} from "../core/tools/tool-executor";
import { useChatStore } from "../features/chat/chat-store";

interface AgentActivityProps {
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
}

export function AgentActivity({ toolCalls, toolResults }: AgentActivityProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const pendingToolApproval = useChatStore((s) => s.pendingToolApproval);
  const approveTool = useChatStore((s) => s.approveTool);
  const denyTool = useChatStore((s) => s.denyTool);

  const resultsByCallId = new Map(toolResults.map((r) => [r.toolCallId, r]));

  const completed = toolCalls.filter((tc) => {
    const r = resultsByCallId.get(tc.id);
    return r && r.error !== TOOL_PERMISSION_REQUIRED;
  }).length;

  const total = toolCalls.length;
  const hasPending = toolCalls.some((tc) => resultsByCallId.get(tc.id)?.error === TOOL_PERMISSION_REQUIRED);

  const hasFailed = toolResults.some(
    (r) => !r.success && r.error !== TOOL_PERMISSION_REQUIRED && r.error !== TOOL_DENIED,
  );

  return (
    <div className="mt-3 border border-border rounded-lg overflow-hidden bg-surface">
      {/* Header — always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover transition"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-medium text-muted">
          {isStreaming && completed < total
            ? t("agent.processing")
            : hasFailed
              ? t("agent.completedWithErrors")
              : t("agent.completed")}
        </span>
        <span className="text-xs text-muted ml-auto">
          {completed}/{total}
        </span>
      </button>

      {/* Compact step list — always visible */}
      <div className="px-3 pb-2 flex flex-col gap-1">
        {toolCalls.slice(0, expanded ? total : 3).map((call) => {
          const result = toolResults.find((r) => r.toolCallId === call.id);
          const isPending = pendingToolApproval?.toolCallId === call.id;
          const isRunning = isPending && isStreaming;
          const permissionRequired = result?.error === TOOL_PERMISSION_REQUIRED;
          const isDenied = result?.error === TOOL_DENIED;

          const icon = isRunning ? (
            <Loader size={12} className="animate-spin text-primary" />
          ) : permissionRequired ? (
            <Circle size={12} className="text-warning" />
          ) : result?.success ? (
            <Check size={12} className="text-success" />
          ) : isDenied ? (
            <X size={12} className="text-muted" />
          ) : result ? (
            <X size={12} className="text-danger" />
          ) : (
            <Circle size={12} className="text-muted" />
          );

          // Get short summary of args
          const rawPath = call.arguments["path"] ?? call.arguments["file_path"];
          const rawProgram = call.arguments["program"];
          const argSummary: string =
            typeof rawPath === "string"
              ? rawPath
              : typeof rawProgram === "string"
                ? `${rawProgram} ${Array.isArray(call.arguments["args"]) ? (call.arguments["args"] as string[]).join(" ") : ""}`
                : "";

          const shortPath = argSummary.split("/").slice(-2).join("/");

          return (
            <div key={call.id} className="flex items-center gap-2 text-xs text-muted py-0.5">
              {icon}
              <span className="font-mono">{call.toolName}</span>
              {shortPath && <span className="truncate text-muted/70">{shortPath}</span>}
            </div>
          );
        })}
        {!expanded && total > 3 && (
          <button
            type="button"
            className="text-xs text-primary hover:underline mt-1"
            onClick={() => setExpanded(true)}
          >
            +{total - 3} more
          </button>
        )}
      </div>

      {/* Approval UI */}
      {hasPending && (
        <div className="px-3 pb-3 border-t border-border pt-2">
          <p className="text-xs text-muted mb-2">{t("tools.permissionRequired")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded-lg bg-primary text-primary-fg text-xs font-medium disabled:opacity-50"
              disabled={isStreaming}
              onClick={() => void approveTool()}
            >
              {t("tools.approve")}
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-lg border border-border text-xs font-medium hover:bg-surface-hover"
              disabled={isStreaming}
              onClick={() => void denyTool()}
            >
              {t("tools.deny")}
            </button>
          </div>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 flex flex-col gap-2">
          {toolCalls.map((call) => {
            const result = toolResults.find((r) => r.toolCallId === call.id);
            const resultText =
              result?.error === TOOL_NOT_AVAILABLE ? t("tools.notAvailable") : result?.output;

            return (
              <div key={call.id} className="text-xs">
                <div className="font-mono font-medium mb-1">{call.toolName}</div>
                <details>
                  <summary className="text-muted cursor-pointer">{t("tools.arguments")}</summary>
                  <pre className="mt-1 p-2 bg-surface-hover rounded text-xs overflow-x-auto">
                    {JSON.stringify(call.arguments, null, 2)}
                  </pre>
                </details>
                {result && (
                  <details>
                    <summary className="text-muted cursor-pointer">{t("tools.result")}</summary>
                    <pre className="mt-1 p-2 bg-surface-hover rounded text-xs overflow-x-auto max-h-[200px] overflow-y-auto">
                      {resultText}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
