import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleSlash2,
  LoaderCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../ui/utils";

/**
 * Evir tool presentation — AI Elements Tool / assistant-ui Tool Timeline
 * pattern, props-driven. Status derivations stay in EvirToolViewModel
 * (features/chat/tool-view-model.ts); these components only render.
 */

export type ToolStatus =
  | "pending"
  | "running"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "denied"
  | "blocked"
  | "cancelled";

const STATUS_ICON: Record<ToolStatus, ReactNode> = {
  pending: <CircleDashed size={13} aria-hidden="true" />,
  running: <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />,
  "waiting-approval": <ShieldAlert size={13} aria-hidden="true" />,
  completed: <CheckCircle2 size={13} aria-hidden="true" />,
  failed: <XCircle size={13} aria-hidden="true" />,
  denied: <Circle size={13} aria-hidden="true" />,
  blocked: <ShieldAlert size={13} className="text-warning" aria-hidden="true" />,
  cancelled: <CircleSlash2 size={13} aria-hidden="true" />,
};

/** Group header: summary-first line, expandable. */
export function ToolGroupHeader({
  className,
  icon,
  summary,
  meta,
  open,
  ...props
}: ComponentProps<"button"> & {
  icon: ReactNode;
  summary: ReactNode;
  meta?: ReactNode;
  open: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "tool-group-header flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted transition-colors select-none hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
        className,
      )}
      aria-expanded={open}
      {...props}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center text-muted"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/90">
        {summary}
        {meta}
      </span>
      <ChevronRight
        size={13}
        aria-hidden="true"
        className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")}
      />
    </button>
  );
}

/** Collapsed content: per-call execution rows. */
export function ToolGroupCalls({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "tool-group-calls ml-[13px] flex flex-col border-l border-border pl-2.5",
        className,
      )}
      {...props}
    />
  );
}

export function ToolRow({
  className,
  status,
  name,
  detail,
  detailTitle,
  statusLabel,
  ...props
}: ComponentProps<"div"> & {
  status: ToolStatus;
  name: ReactNode;
  detail?: ReactNode;
  detailTitle?: string;
  statusLabel: ReactNode;
}) {
  const tone =
    status === "failed"
      ? "text-danger"
      : status === "waiting-approval" || status === "blocked"
        ? "text-warning"
        : status === "completed"
          ? "text-success/80"
          : "text-muted";
  return (
    <div
      className={cn(
        "execution-step flex items-center gap-2 rounded-md py-1 pr-1 text-[12px]",
        className,
      )}
      {...props}
    >
      <span
        className={cn("flex size-4 shrink-0 items-center justify-center", tone)}
        aria-hidden="true"
      >
        {STATUS_ICON[status]}
      </span>
      <span className="shrink-0 font-medium text-foreground/90">{name}</span>
      {detail != null && detail !== "" && (
        <span className="min-w-0 flex-1 truncate text-muted" title={detailTitle}>
          {detail}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[11px] text-muted">{statusLabel}</span>
    </div>
  );
}

/** Timeline wrapper that groups the tool sections under one activity header. */
export function ToolTimeline({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-col gap-0.5", className)} {...props} />;
}
