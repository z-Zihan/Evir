import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        // One focus visual: the ring replaces the outline (not removes it) so
        // keyboard focus stays obvious in both themes without doubling with
        // the app-level focus safety net.
        "h-8 w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 py-1 text-[13px] hover:border-border-strong text-foreground transition-colors select-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "field-sizing-content min-h-16 w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] hover:border-border-strong text-foreground transition-colors placeholder:text-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("text-[12px] leading-none font-medium text-foreground select-none", className)}
      {...props}
    />
  );
}
