import { useEffect, useState } from "react";
/* eslint-disable react-refresh/only-export-components -- mixed parts module: the editable plan step component shares its status helpers with TaskWorkbench */
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import { Button, Input, Tip } from "../components/ui";
import { PlanNodeIcon, PlanStep, PlanStepMarker, type PlanNodeStatus } from "../components/ai";
import { cn } from "../components/ui/utils";
import { getRuntime } from "../runtime/use-runtime";
import { useChatStore } from "../features/chat/chat-store";
import { reviseCurrentPlan } from "../features/orchestration/orchestration-session";
import type { NodeStatus, PlanGraph, PlanNode } from "../core/orchestration/types";
import type { AgentRunStatus } from "../features/chat/agent-run-record";

export type FinishedStatus = "completed" | "partial" | "failed" | "cancelled";

export function reconcileFinishedStatus(
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

export function nodeStatusOf(status: NodeStatus): PlanNodeStatus {
  return status;
}

export function useElapsedSeconds(startedAt: number | undefined): number {
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

export function EditableStep({ node }: { node: PlanNode }) {
  const { t } = useTranslation();
  const privateSession = useChatStore((state) => state.privateSession);
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(node.objective);
  const save = async () => {
    if (await reviseCurrentPlan(node.id, objective, getRuntime(), privateSession))
      setEditing(false);
  };
  const tone =
    node.status === "running"
      ? "text-primary"
      : node.status === "failed"
        ? "text-danger"
        : "text-foreground";
  return (
    <PlanStep className={`task-step task-step-${node.status}`}>
      <PlanStepMarker>
        <PlanNodeIcon status={nodeStatusOf(node.status)} size={13} />
      </PlanStepMarker>
      <div className={cn("task-step-copy min-w-0 flex-1 leading-snug", tone)}>
        <strong className="block text-[12px] font-semibold">{node.title}</strong>
        {editing ? (
          <div className="task-step-editor mt-1 flex items-center gap-1.5">
            <Input
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              aria-label={t("orchestration.editStep")}
              className="h-7 text-[12px]"
            />
            <Button variant="primary" size="sm" onClick={() => void save()}>
              {t("common.save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <span className="text-[11.5px] text-muted">{node.objective}</span>
        )}
      </div>
      {node.status === "pending" && !editing && (
        <Tip content={t("orchestration.editStep")}>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            className="task-icon-button"
            onClick={() => setEditing(true)}
            aria-label={t("orchestration.editStep")}
          >
            <Pencil size={12} />
          </Button>
        </Tip>
      )}
    </PlanStep>
  );
}
