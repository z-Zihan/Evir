import { Collapsible as CollapsiblePrimitive } from "@base-ui-components/react/collapsible";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Panel>) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-150 ease-out data-[ending-style],[data-[starting-style]]:h-0",
        className,
      )}
      {...props}
    />
  );
}
