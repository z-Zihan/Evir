import { Popover as PopoverPrimitive } from "@base-ui-components/react/popover";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  side = "bottom",
  align = "start",
  sideOffset = 6,
  className,
  children,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Positioner> & {
  side?: NonNullable<ComponentProps<typeof PopoverPrimitive.Positioner>["side"]>;
  align?: NonNullable<ComponentProps<typeof PopoverPrimitive.Positioner>["align"]>;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-[100] outline-none"
        {...props}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "origin-[var(--transform-origin)] rounded-xl border border-border bg-surface-elevated p-1 text-foreground shadow-popover data-[ending-style,starting-style]:scale-95 data-[ending-style,starting-style]:opacity-0 transition-[transform,opacity] duration-150 data-[starting-style]:-translate-y-0.5",
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-2 pt-1.5 pb-1", className)} {...props} />;
}

export function PopoverTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-[12px] font-semibold text-foreground", className)} {...props} />;
}
