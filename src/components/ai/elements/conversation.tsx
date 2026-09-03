"use client";

/**
 * Vendored from vercel/ai-elements `packages/elements/src/conversation.tsx`
 * (Apache-2.0). Adaptations from the upstream source:
 * - `@repo/shadcn-ui/*` imports mapped to Evir's `components/ui`;
 * - the StickToBottom-based root, ScrollButton, and Download exports are
 *   intentionally not vendored: Evir's own MessageScroller owns scrolling
 *   (direction-aware follow, jump-to-latest, force-scroll API) and is covered
 *   by its own tests; this file keeps the conversation layout primitives.
 */

import { cn } from "../../ui/utils";
import type { ComponentProps } from "react";

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <div className={cn("flex flex-col gap-8 p-4", className)} {...props} />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
      </>
    )}
  </div>
);
