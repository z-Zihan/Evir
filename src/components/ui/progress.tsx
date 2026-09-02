import { Progress as ProgressPrimitive } from "@base-ui-components/react/progress";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Progress({ className, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root className={cn("w-full", className)} {...props}>
      <ProgressPrimitive.Track className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
        <ProgressPrimitive.Indicator className="rounded-full bg-primary transition-[width] duration-200" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}
