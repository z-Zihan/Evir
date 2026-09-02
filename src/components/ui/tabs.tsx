import { Tabs as TabsPrimitive } from "@base-ui-components/react/tabs";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-surface-hover p-0.5",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTab({ className, ...props }: ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-muted outline-offset-2 outline-focus transition-colors select-none hover:text-foreground focus-visible:outline-2 data-[selected]:bg-surface data-[selected]:text-foreground data-[selected]:shadow-sm data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: ComponentProps<typeof TabsPrimitive.Panel>) {
  return <TabsPrimitive.Panel className={cn("outline-none", className)} {...props} />;
}

/**
 * Underline tab row — for embedded panels (workspace tabs) where a pill
 * background would be too heavy.
 */
export function TabsListUnderline({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex items-end gap-3 border-b border-border px-1", className)}
      {...props}
    />
  );
}

export function TabsTabUnderline({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "-mb-px inline-flex h-8 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-1 text-[12.5px] font-medium text-muted outline-offset-2 outline-focus transition-colors select-none hover:text-foreground focus-visible:outline-2 data-[selected]:border-primary data-[selected]:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
