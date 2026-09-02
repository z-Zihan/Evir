import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-px text-[11px] font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-surface-hover text-foreground",
        secondary: "border-border bg-surface text-muted",
        primary: "border-transparent bg-primary text-primary-fg",
        success: "border-transparent bg-transparent text-success",
        warning: "border-transparent bg-transparent text-warning",
        danger: "border-transparent bg-transparent text-danger",
        outline: "border-border text-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
