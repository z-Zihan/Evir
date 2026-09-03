import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui";
import { cn } from "../../components/ui/utils";

/**
 * Unified preview chrome (§14). Every renderer composes the same shell,
 * toolbar and status surfaces instead of painting its own, so PDF, CSV,
 * HTML/SVG, JSON/data trees and code all read as one product surface.
 */

/** Outer container: bordered surface with a scrollable body. */
export function PreviewShell({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Toolbar row: leading status/meta on the left, actions on the right.
 * Replaces per-renderer toolbars (pdf-toolbar, code-block-header, …).
 */
export function PreviewToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-subtle px-2",
        className,
      )}
      {...props}
    />
  );
}

export function PreviewToolbarMeta({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("min-w-0 truncate px-1 text-[11px] text-muted tabular-nums", className)}
      {...props}
    />
  );
}

export function PreviewToolbarActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-0.5", className)} {...props} />;
}

/** Compact loading line for renderer-internal waits. */
export function PreviewLoading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center gap-2 p-6 text-muted" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      <span className="text-[12px]">{label ?? t("preview.loading")}</span>
    </div>
  );
}

export interface PreviewErrorProps {
  message: ReactNode;
  /** Detail line (parse error text etc.), kept secondary to the headline. */
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** Compact error surface: headline + optional detail + optional retry. */
export function PreviewError({
  message,
  detail,
  onRetry,
  retryLabel,
  className,
}: PreviewErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center",
        className,
      )}
      role="alert"
    >
      <CircleAlert className="size-5 text-danger" aria-hidden="true" />
      <p className="m-0 text-[12.5px] font-medium text-foreground">{message}</p>
      {detail ? <p className="m-0 max-w-[520px] text-[11px] text-muted">{detail}</p> : null}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-1" onClick={onRetry}>
          {retryLabel ?? t("common.retry")}
        </Button>
      )}
    </div>
  );
}

/** Compact empty/notice surface (empty content, fallback text). */
export function PreviewNotice({ message, className }: { message: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center p-6 text-center text-[12px] text-muted",
        className,
      )}
    >
      {message}
    </div>
  );
}

/** Footer strip for truncation/limit notes (CSV row cap, tree child cap). */
export function PreviewFooterNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "m-0 shrink-0 border-t border-border bg-surface-subtle px-3 py-1.5 text-[10.5px] text-muted",
        className,
      )}
      {...props}
    />
  );
}
