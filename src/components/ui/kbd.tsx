import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-md border border-border bg-surface px-1 font-sans text-[11px] font-medium text-muted select-none",
        className,
      )}
      {...props}
    />
  );
}
