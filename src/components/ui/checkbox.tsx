import { Checkbox as CheckboxPrimitive } from "@base-ui-components/react/checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-[5px] border border-border-strong bg-surface transition-colors outline-offset-2 outline-focus select-none focus-visible:outline-2 data-[checked]:border-primary data-[checked]:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center text-white">
        <Check size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
