import { Paperclip, Square, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "../ui/button";
import { Tip } from "../ui/tooltip";
import { cn } from "../ui/utils";

/**
 * Evir composer presentation — AI Elements PromptInput pattern, fully
 * props-driven. Submit/clear semantics stay in ChatView: the form never
 * resets until Evir has accepted and persisted the message.
 */
export function PromptInput({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "composer rounded-xl border border-border bg-surface shadow-xs transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputChips({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 px-3 pt-2.5", className)} {...props} />
  );
}

export function PromptInputChip({
  className,
  onRemove,
  removeLabel,
  media,
  children,
}: {
  className?: string;
  onRemove?: () => void;
  removeLabel?: string;
  media?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "pending-attachment-chip inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-surface-hover py-1 pr-1 pl-2 text-[11.5px] text-foreground",
        className,
      )}
    >
      {media}
      <span className="truncate">{children}</span>
      {onRemove && (
        <Tip content={removeLabel ?? ""}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={removeLabel}
            onClick={onRemove}
            className="text-muted hover:text-foreground"
          >
            <X size={11} />
          </Button>
        </Tip>
      )}
    </span>
  );
}

export function PromptInputThumb({ src, alt }: { src: string; alt: string }) {
  return (
    <img src={src} alt={alt} className="size-6 rounded-sm border border-border object-cover" />
  );
}

export function PromptInputTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "composer-footer flex items-center justify-between gap-2 px-2.5 pb-2.5",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputTools({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export function PromptInputContext({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 items-center gap-1.5", className)} {...props} />;
}

export function PromptInputAttach({ className, ...props }: ComponentProps<"button">) {
  return (
    <Tip content={String(props["aria-label"] ?? "")}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn("text-muted hover:text-foreground", className)}
        {...props}
      >
        <Paperclip size={15} />
      </Button>
    </Tip>
  );
}

export function PromptInputSubmit({
  className,
  streaming,
  ...props
}: ComponentProps<"button"> & { streaming?: boolean }) {
  if (streaming) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className={cn("gap-1.5 rounded-lg px-3", className)}
        {...props}
      >
        <Square size={13} />
      </Button>
    );
  }
  return (
    <Button variant="contrast" size="sm" className={cn("rounded-lg px-3", className)} {...props} />
  );
}
