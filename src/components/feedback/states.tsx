import type { ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Empty, EmptyAction, EmptyDescription, EmptyIcon, EmptyTitle, Button } from "../ui";

/**
 * Shared content-state composites (§19): the three states every surface must
 * render instead of ad-hoc markup.
 *
 * - LoadingState: short operations; lists use skeletons; long operations keep
 *   their own progress/status UI.
 * - ErrorState: the current content cannot be used. Technical detail belongs
 *   in diagnostics/logs, not in the headline message.
 * - EmptyState: composed on ui/empty with the standard icon/title/description/
 *   actions slots.
 */

export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 p-6 text-center ${className ?? ""}`}
      role="status"
    >
      <LoaderCircle className="size-5 animate-spin text-muted" aria-hidden="true" />
      <span className="text-[12px] text-muted">{label ?? t("notify.working")}</span>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** Primary recovery action, e.g. Retry. */
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
  className?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  children,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 p-6 text-center ${className ?? ""}`}
      role="alert"
    >
      <EmptyIcon>
        <CircleAlert />
      </EmptyIcon>
      <EmptyTitle>{title ?? t("notify.failed")}</EmptyTitle>
      {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      {(onRetry || children) && (
        <EmptyAction>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {retryLabel ?? t("common.retry")}
            </Button>
          )}
          {children}
        </EmptyAction>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={className}>
      {icon ? <EmptyIcon>{icon}</EmptyIcon> : null}
      <EmptyTitle>{title}</EmptyTitle>
      {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      {(primaryAction || secondaryAction) && (
        <EmptyAction>
          {primaryAction}
          {secondaryAction}
        </EmptyAction>
      )}
    </Empty>
  );
}

/** In-place failure for a bounded region (form row, panel section). */
export function InlineError({ message, className }: { message: ReactNode; className?: string }) {
  return (
    <p
      className={`flex items-start gap-1.5 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-[12px] leading-relaxed text-danger ${className ?? ""}`}
      role="alert"
    >
      {message}
    </p>
  );
}
