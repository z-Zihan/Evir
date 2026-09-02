import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "./utils";

/**
 * Portal-based tooltip with collision handling — replaces the CSS-only
 * [data-tip] system and its manual direction-flip helper.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Composition shortcut for the common icon-control tooltip. `children` must
 * be a single element (usually a Button); it becomes the trigger via Base UI's
 * render prop, so no wrapper element is added to the layout.
 */
export function Tip({
  content,
  side = "top",
  align = "center",
  children,
}: {
  content: string;
  side?: NonNullable<ComponentProps<typeof TooltipPrimitive.Positioner>["side"]>;
  align?: NonNullable<ComponentProps<typeof TooltipPrimitive.Positioner>["align"]>;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

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
            "rounded-md border border-border bg-surface-elevated px-2 py-1 text-[11.5px] leading-[1.45] text-foreground shadow-tooltip transition-opacity data-[ending-style,starting-style]:opacity-0",
            className,
          )}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
