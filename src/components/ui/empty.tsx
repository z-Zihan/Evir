import type { ComponentProps } from "react";

import { cn } from "./utils";

/** Shared empty-state composition — replaces the ~10 ad-hoc `*-empty` CSS variants. */
export function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-1 p-6 text-center", className)}
      {...props}
    />
  );
}

export function EmptyIcon({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mb-1 flex size-9 items-center justify-center text-muted [&_svg]:size-5",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-[13px] font-medium text-foreground", className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("max-w-72 text-[12px] text-muted", className)} {...props} />;
}

export function EmptyAction({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-3 flex items-center gap-2", className)} {...props} />;
}
