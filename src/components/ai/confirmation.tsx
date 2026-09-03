import { ShieldAlert } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "../ui/button";
import { cn } from "../ui/utils";

/**
 * Evir approval presentation — assistant-ui standalone Confirmation/Permission
 * pattern, props-driven. The approve/deny actions are supplied by ChatView's
 * approval runtime; this component never mutates domain state.
 */
export function ConfirmationCard({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "approval-panel overflow-hidden rounded-xl border border-warning/45 bg-surface shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function ConfirmationHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 border-b border-border bg-warning/[0.06] px-3.5 py-3",
        className,
      )}
      {...props}
    />
  );
}

export function ConfirmationIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning",
        className,
      )}
      aria-hidden="true"
      {...props}
    >
      <ShieldAlert size={14} />
    </span>
  );
}

export function ConfirmationTitle({ className, ...props }: ComponentProps<"strong">) {
  return (
    <strong
      className={cn("block text-[13px] font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function ConfirmationDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p className={cn("mt-0.5 text-[12px] leading-relaxed text-muted", className)} {...props} />
  );
}

/** Key/value facts grid (tool, risk, target, data destination, impact…). */
export function ConfirmationFacts({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      className={cn(
        "approval-facts grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-[11.5px] sm:grid-cols-[auto_auto_1fr]",
        className,
      )}
      {...props}
    />
  );
}

export function ConfirmationFact({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("contents", className)} {...props} />;
}

export function ConfirmationFactLabel({ className, ...props }: ComponentProps<"dt">) {
  return <dt className={cn("text-muted", className)} {...props} />;
}

export function ConfirmationFactValue({ className, ...props }: ComponentProps<"dd">) {
  return (
    <dd
      className={cn(
        "col-span-2 min-w-0 break-all font-medium text-foreground/90 sm:col-span-1",
        className,
      )}
      {...props}
    />
  );
}

export function ConfirmationActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "approval-actions flex items-center justify-end gap-2 border-t border-border bg-surface-subtle px-3.5 py-2.5",
        className,
      )}
      {...props}
    />
  );
}

export function ConfirmationDenyButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="outline" size="sm" className={cn("h-8", className)} {...props} />;
}

export function ConfirmationApproveButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="primary" size="sm" className={cn("h-8", className)} {...props} />;
}
