import type { ComponentProps } from "react";

import { cn } from "./utils";

/** Compact list-row composition for dense desktop surfaces (outputs, files, providers). */
export function Item({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors",
        className,
      )}
      {...props}
    />
  );
}

export function ItemInteractive({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-foreground transition-colors outline-offset-2 outline-focus select-none hover:bg-surface-hover focus-visible:outline-2",
        className,
      )}
      {...props}
    />
  );
}

export function ItemMedia({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex size-6 shrink-0 items-center justify-center text-muted", className)}
      {...props}
    />
  );
}

export function ItemContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-px", className)} {...props} />;
}

export function ItemTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("truncate text-[12.5px] font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function ItemDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("truncate text-[11.5px] text-muted", className)} {...props} />;
}

export function ItemActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}
