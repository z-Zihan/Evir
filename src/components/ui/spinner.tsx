import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Spinner({ className, ...props }: ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      size={14}
      aria-hidden="true"
      className={cn("animate-spin", className)}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-surface-hover", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
