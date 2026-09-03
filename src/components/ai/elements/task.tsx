"use client";

/**
 * Vendored from vercel/ai-elements `packages/elements/src/task.tsx`
 * (Apache-2.0). Adaptation: `@repo/shadcn-ui/*` imports mapped to Evir's
 * `components/ui` (Collapsible primitive).
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { cn } from "../../ui/utils";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type TaskItemFileProps = ComponentProps<"div">;

export const TaskItemFile = ({ children, className, ...props }: TaskItemFileProps) => (
  <div
    className={cn(
      "inline-flex items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 text-foreground text-xs",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<"div">;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn("text-muted-foreground text-sm", className)} {...props}>
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({ defaultOpen = true, className, ...props }: TaskProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export const TaskTrigger = ({ children, className, title, ...props }: TaskTriggerProps) => {
  const defaultTrigger = (
    <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
      <SearchIcon className="size-4" />
      <p className="text-sm">{title}</p>
      <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
    </div>
  );

  return (
    // Base UI composes triggers via render (see message.tsx note).
    <CollapsibleTrigger
      render={(children ?? defaultTrigger) as never}
      className={cn("group", className)}
      {...props}
    />
  );
};

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({ children, className, ...props }: TaskContentProps) => (
  <CollapsibleContent className={cn("text-popover-foreground outline-none", className)} {...props}>
    <div className="mt-4 space-y-2 border-muted border-l-2 pl-4">{children}</div>
  </CollapsibleContent>
);
