import { Select as SelectPrimitive } from "@base-ui-components/react/select";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-1 text-[13px] hover:border-border-strong text-foreground transition-colors select-none data-[popup-open]:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown size={14} className="text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  side = "bottom",
  sideOffset = 4,
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Positioner> & {
  side?: NonNullable<ComponentProps<typeof SelectPrimitive.Positioner>["side"]>;
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        className="z-[100] outline-none"
        {...props}
      >
        <SelectPrimitive.Popup
          className={cn(
            "origin-[var(--transform-origin)] max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border border-border bg-surface-elevated p-1 text-foreground shadow-popover transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "grid cursor-default grid-cols-[0.9rem_1fr] items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-foreground outline-none select-none data-highlighted:bg-surface-hover data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="col-start-1" />
      <SelectPrimitive.ItemText className="col-start-2">{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      className={cn("px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted", className)}
      {...props}
    />
  );
}
