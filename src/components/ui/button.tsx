import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/**
 * Evir button primitive. Visual language matches the app's dense desktop
 * feel: 28–38px control heights, 8px radius, 600-weight 12.5px labels —
 * not the shadcn defaults.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent font-semibold transition-colors duration-150 outline-offset-2 outline-focus select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary text-primary-fg shadow-[0_5px_16px_color-mix(in_srgb,var(--color-primary)_20%,transparent)] hover:bg-primary-hover",
        secondary:
          "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-hover",
        outline: "border-border bg-transparent text-foreground hover:bg-surface-hover",
        ghost: "text-muted hover:bg-surface-hover hover:text-foreground",
        destructive: "border-danger bg-danger text-white hover:opacity-90",
        "ghost-destructive":
          "text-muted hover:border-danger/40 hover:bg-surface-hover hover:text-danger",
        /** Foreground-on-surface contrast action (composer send). */
        contrast: "bg-foreground text-surface hover:bg-foreground/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-[11.5px]",
        default: "h-8 px-3 text-[12.5px]",
        lg: "h-[38px] px-3.5 text-[12.5px]",
        "icon-xs": "size-6 rounded-md",
        "icon-sm": "size-7 rounded-md",
        icon: "size-8",
        "icon-lg": "size-[38px]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
