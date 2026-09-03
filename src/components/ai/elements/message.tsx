"use client";

/**
 * Vendored from vercel/ai-elements `packages/elements/src/message.tsx`
 * (Apache-2.0). Adaptations from the upstream source:
 * - `@repo/shadcn-ui/*` imports mapped to Evir's `components/ui`;
 * - MessageBranch* (branch navigation) is not vendored: Evir deliberately
 *   does not expose conversation branching (enforced by tests);
 * - MessageResponse (Streamdown markdown) is not vendored: Evir renders
 *   assistant content through its own MarkdownContent (shiki/KaTeX/
 *   lightbox/code view) as children of MessageContent.
 * - TooltipTrigger composition uses Base UI's render prop (Evir primitive
 *   layer) instead of Radix asChild.
 */

import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "../../ui/utils";
import type { ComponentProps, HTMLAttributes } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | "system";
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    // Base UI (Evir's primitive layer) composes triggers via `render`
    // instead of Radix's asChild.
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
  <div className={cn("mt-4 flex w-full items-center justify-between gap-4", className)} {...props}>
    {children}
  </div>
);
