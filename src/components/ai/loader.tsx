import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../ui/utils";

/** Three-dot thinking indicator shown while the first streamed tokens are pending. */
export function ThinkingDots({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-1 py-1", className)}
      role="status"
      aria-label="thinking"
      {...props}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${index * 150}ms`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}

/** Inline busy spinner with an optional status label (tool rows, headers). */
export function BusyIndicator({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-muted", className)} {...props}>
      <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
    </span>
  );
}
