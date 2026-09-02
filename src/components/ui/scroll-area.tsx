import { ScrollArea as ScrollAreaPrimitive } from "@base-ui-components/react/scroll-area";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/**
 * Styled scroll container with slim overlaying scrollbars. Use for chrome
 * surfaces (menus, panels, lists); the main conversation keeps native
 * scrolling for streaming performance.
 */
export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="size-full overscroll-contain rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar className="flex w-2 justify-center rounded-full opacity-0 transition-opacity delay-150 duration-100 data-[hovering]:opacity-100 data-[scrolling]:opacity-100 data-[has-overflow-y]:flex data-[has-overflow-x]:flex">
        <ScrollAreaPrimitive.Thumb className="w-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-border-strong)_72%,transparent)]" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Scrollbar
        orientation="horizontal"
        className="flex h-2 items-center justify-center rounded-full opacity-0 transition-opacity delay-150 duration-100 data-[hovering]:opacity-100 data-[scrolling]:opacity-100 data-[has-overflow-y]:flex data-[has-overflow-x]:flex"
      >
        <ScrollAreaPrimitive.Thumb className="h-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-border-strong)_72%,transparent)]" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
