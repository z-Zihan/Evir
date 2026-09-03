import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleSlash2,
  LoaderCircle,
  PauseCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../ui/utils";

/** Plan-node / run status iconography shared by TaskWorkbench and summaries. */
export type PlanNodeStatus =
  "pending" | "ready" | "running" | "completed" | "failed" | "cancelled" | "skipped" | "blocked";

export function PlanNodeIcon({ status, size = 14 }: { status: PlanNodeStatus; size?: number }) {
  if (status === "running")
    return <LoaderCircle size={size} className="animate-spin text-primary" aria-hidden="true" />;
  if (status === "completed")
    return <CheckCircle2 size={size} className="text-success" aria-hidden="true" />;
  if (status === "failed")
    return <XCircle size={size} className="text-danger" aria-hidden="true" />;
  if (status === "cancelled" || status === "skipped")
    return <CircleSlash2 size={size} className="text-muted" aria-hidden="true" />;
  if (status === "blocked")
    return <ShieldAlert size={size} className="text-warning" aria-hidden="true" />;
  if (status === "ready")
    return <CircleDashed size={size} className="text-primary/80" aria-hidden="true" />;
  return <Circle size={size} className="text-muted/70" aria-hidden="true" />;
}

/** Rounded container card used by TaskWorkbench / summaries / clarification forms. */
export function TaskCard({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "task-workbench overflow-hidden rounded-xl border border-border bg-surface shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

/** Section heading row inside a task card (icon + title + caption). */
export function TaskSectionHeading({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("task-section-heading flex items-start gap-2 px-3.5 pt-3", className)}
      {...props}
    />
  );
}

export function TaskSectionTitle({ className, ...props }: ComponentProps<"strong">) {
  return (
    <strong
      className={cn("block text-[12.5px] font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function TaskSectionCaption({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("block text-[11.5px] text-muted", className)} {...props} />;
}

/** Vertical plan timeline: marker column + connecting rail. */
export function PlanTimeline({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn(
        "plan-timeline ml-[26px] flex flex-col border-l border-border px-3.5 py-1",
        className,
      )}
      {...props}
    />
  );
}

export function PlanStep({ className, ...props }: ComponentProps<"li">) {
  return (
    <li className={cn("task-step relative flex items-start gap-2 py-1.5", className)} {...props} />
  );
}

export function PlanStepMarker({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "absolute top-2 -left-[22px] flex size-[15px] items-center justify-center rounded-full bg-surface",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Compact paused/run-state strip (clarification / confirmation / blocked). */
export function TaskPauseStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("task-preparation-strip flex items-start gap-2.5 px-3.5 py-2.5", className)}
      {...props}
    />
  );
}

export function PauseIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning",
        className,
      )}
      aria-hidden="true"
      {...props}
    >
      <PauseCircle size={14} />
    </span>
  );
}
