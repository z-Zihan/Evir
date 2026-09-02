import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/**
 * Portal-based tooltip with collision handling — replaces the CSS-only
 * [data-tip] system and its manual direction-flip helper.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  side = "top",
  align = "center",
  sideOffset = 6,
  className,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Positioner> & {
  side?: NonNullable<ComponentProps<typeof TooltipPrimitive.Positioner>["side"]>;
  align?: NonNullable<ComponentProps<typeof TooltipPrimitive.Positioner>["align"]>;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-[90] max-w-70"
        {...props}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11.5px] leading-[1.45] text-foreground shadow-tooltip data-[ending-style,starting-style]:opacity-0 data-[starting-style]:translate-y-0.5 transition-opacity",
            className,
          )}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
