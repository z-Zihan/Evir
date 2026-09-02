import { Switch as SwitchPrimitive } from "@base-ui-components/react/switch";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/** Replaces the 5 hand-built switch visuals (provider/mcp/skill/memory/personalization). */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface-hover p-px transition-colors outline-offset-2 outline-focus select-none focus-visible:outline-2 data-[checked]:border-primary data-[checked]:bg-primary data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "size-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 data-[checked]:translate-x-[14px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
