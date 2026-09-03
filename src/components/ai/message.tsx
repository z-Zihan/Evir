import type { ComponentProps } from "react";

import { cn } from "../ui/utils";

/**
 * Evir conversation presentation primitives — shadcn chat Message pattern,
 * props-driven: all content and role flow in from Evir's message records,
 * nothing here owns domain state.
 *
 * Visual contract (new design language):
 * - user   → right-aligned subtle bubble, strong contrast against the flat page
 * - assistant → flat content-first block on the page surface (no card)
 * - role rail (avatar mark) only on the first row of a group
 */

export function Message({
  className,
  role,
  grouped,
  ...props
}: ComponentProps<"article"> & { role: "user" | "assistant" | "system"; grouped?: boolean }) {
  return (
    <article
      data-role={role}
      data-grouped={grouped || undefined}
      className={cn(
        "message-row group flex min-w-0 gap-2.5",
        `message-${role}`,
        grouped && "message-grouped",
        role === "user" ? "justify-end" : "justify-start",
        className,
      )}
      {...props}
    />
  );
}

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

export function MessageBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("message-main flex min-w-0 max-w-full flex-col gap-1", className)}
      {...props}
    />
  );
}

export function MessageHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn("message-header flex h-5 items-center gap-2 text-[11px] text-muted", className)}
      {...props}
    />
  );
}

export function MessageAuthor({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("message-author font-medium text-foreground/85", className)} {...props} />
  );
}

export function MessageTime({ className, ...props }: ComponentProps<"time">) {
  return <time className={cn("text-muted/80", className)} {...props} />;
}

/**
 * Content surface: assistant text renders flat on the page; user text gets
 * the subtle bubble. Attachments/skills/status compose inside.
 */
export function MessageContent({
  className,
  role,
  bubble = false,
  ...props
}: ComponentProps<"div"> & { role: "user" | "assistant" | "system"; bubble?: boolean }) {
  return (
    <div
      className={cn(
        "message-content min-w-0 text-[13px] leading-relaxed",
        bubble
          ? "max-w-[min(560px,88%)] rounded-xl rounded-tr-sm border border-border bg-surface-hover px-3.5 py-2.5"
          : "w-full",
        className,
      )}
      data-role={role}
      {...props}
    />
  );
}

/** Hover-revealed action row under a message (copy / edit / regenerate). */
export function MessageActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-6 items-center gap-0.5 opacity-0 transition-opacity duration-150",
        "group-hover:opacity-100 focus-within:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export function MessageActionButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] text-muted transition-colors select-none hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50",
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
