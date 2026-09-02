import { Separator as SeparatorPrimitive } from "@base-ui-components/react/separator";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export type SeparatorProps = ComponentProps<typeof SeparatorPrimitive>;

export function Separator({ className, orientation = "horizontal", ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}
