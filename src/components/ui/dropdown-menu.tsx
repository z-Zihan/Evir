import { Menu as MenuPrimitive } from "@base-ui-components/react/menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  side = "bottom",
  align = "start",
  sideOffset = 6,
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.Positioner> & {
  side?: NonNullable<ComponentProps<typeof MenuPrimitive.Positioner>["side"]>;
  align?: NonNullable<ComponentProps<typeof MenuPrimitive.Positioner>["align"]>;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-[100] outline-none"
        {...props}
      >
        <MenuPrimitive.Popup
          className={cn(
            "origin-[var(--transform-origin)] min-w-36 rounded-xl border border-border bg-surface-elevated p-1 text-foreground shadow-popover data-[ending-style,starting-style]:scale-95 data-[ending-style,starting-style]:opacity-0 transition-[transform,opacity] duration-150",
            className,
          )}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-foreground outline-none select-none data-highlighted:bg-surface-hover data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted",
        destructive && "text-danger data-highlighted:bg-danger/10 [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(
        "grid cursor-default grid-cols-[0.9rem_1fr] items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-foreground outline-none select-none data-highlighted:bg-surface-hover",
        className,
      )}
      {...props}
    >
      <MenuPrimitive.CheckboxItemIndicator>
        <Check className="size-3.5" />
      </MenuPrimitive.CheckboxItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export const DropdownMenuSub = MenuPrimitive.SubmenuRoot;
export const DropdownMenuSubTrigger = MenuPrimitive.SubmenuTrigger;

export function DropdownMenuSubContent({
  side = "right",
  align = "start",
  sideOffset = 6,
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.Positioner> & {
  side?: NonNullable<ComponentProps<typeof MenuPrimitive.Positioner>["side"]>;
  align?: NonNullable<ComponentProps<typeof MenuPrimitive.Positioner>["align"]>;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-[100] outline-none"
        {...props}
      >
        <MenuPrimitive.Popup
          className={cn(
            "origin-[var(--transform-origin)] min-w-36 rounded-xl border border-border bg-surface-elevated p-1 text-foreground shadow-popover transition-[transform,opacity] duration-150 data-[ending-style,starting-style]:scale-95 data-[ending-style,starting-style]:opacity-0",
            className,
          )}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}
