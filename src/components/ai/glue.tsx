/**
 * Evir-specific presentation glue without an upstream equivalent: the
 * message rail (avatar mark on group heads), read-only status strip, and
 * the localized role mark. Composed with the vendored AI Elements
 * components in ChatMessage.
 */
import type { ComponentProps } from "react";

import { cn } from "../ui/utils";

/** Left rail: avatar mark on group heads, spacer on continuation rows. */
export function MessageRail({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("message-rail flex w-6 shrink-0 flex-col items-center self-start", className)}
      {...props}
    />
  );
}

export function MessageRoleMark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "message-role-mark grid size-6 place-items-center overflow-hidden rounded-md border border-border bg-surface text-[10px] font-semibold text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Status strip for stopped / error states under the content. */
export function MessageState({
  className,
  tone = "muted",
  ...props
}: ComponentProps<"div"> & { tone?: "muted" | "error" }) {
  return (
    <div
      className={cn(
        "message-state mt-1 flex items-center gap-2 text-[12px]",
        tone === "error" ? "text-danger" : "text-muted",
        className,
      )}
      {...props}
    />
  );
}
