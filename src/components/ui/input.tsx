import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 py-1 text-[13px] text-foreground transition-colors select-none placeholder:text-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
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
        "field-sizing-content min-h-16 w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground transition-colors placeholder:text-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
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
