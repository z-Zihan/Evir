"use client";

/**
 * Command primitives (shadcn/ui `command.tsx` layout, MIT) adapted to Evir's
 * primitive layer: cmdk provides the combobox engine; styling uses Evir's
 * design tokens (surface-elevated / border / muted) instead of shadcn's
 * defaults. The Dialog variant is intentionally not vendored — Evir embeds
 * Command in its own anchored surfaces (e.g. the composer slash palette).
 */

import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export const Command = ({ className, ...props }: ComponentProps<typeof CommandPrimitive>) => (
  <CommandPrimitive
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-xl bg-surface-elevated text-foreground",
      className,
    )}
    {...props}
  />
);

export const CommandList = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    {...props}
  />
);

/**
 * Search input bound to the Command's internal filter state. Evir's slash
 * palette keeps focus in the composer textarea and mirrors the query here via
 * the controlled `value` prop, so this renders visually hidden in that
 * context — direct consumers may style it visibly.
 */
export const CommandInput = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) => (
  <CommandPrimitive.Input
    className={cn(
      "h-8 w-full rounded-lg border-none bg-transparent px-3 text-[13px] text-foreground outline-hidden placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export const CommandGroup = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    className={cn(
      "text-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase",
      className,
    )}
    {...props}
  />
);

export const CommandItem = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn(
      "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] outline-none select-none data-[selected=true]:bg-surface-hover data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      className,
    )}
    {...props}
  />
);

export const CommandEmpty = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty
    className={cn("px-3 py-2.5 text-[11.5px] text-muted", className)}
    {...props}
  />
);

export const CommandSeparator = ({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) => (
  <CommandPrimitive.Separator className={cn("-mx-1 h-px bg-border", className)} {...props} />
);

export const CommandShortcut = ({ className, ...props }: ComponentProps<"span">) => (
  <span className={cn("ml-auto text-[10.5px] tracking-widest text-muted", className)} {...props} />
);
