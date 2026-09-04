"use client";

/**
 * Vendored (core subset) from vercel/ai-elements
 * `packages/elements/src/prompt-input.tsx` (Apache-2.0).
 * Adaptations from the upstream source:
 * - `@repo/shadcn-ui/*` imports mapped to Evir's `components/ui`;
 *   InputGroupButton/InputGroupTextarea/InputGroupAddon are rendered with
 *   Evir's Button/Textarea primitives plus the upstream class contract.
 * - The InputGroup container contract is preserved on the trimmed root:
 *   `data-slot="input-group-control"` on the textarea + `has-[…:focus-visible]`
 *   border/ring propagation on the container, so focus visuals stay the
 *   upstream mechanism (restrained via Evir's ring tokens).
 * - The upstream attachments controller, action menu, screenshot capture,
 *   model selector, speech input, and referenced-sources sub-features are
 *   intentionally not vendored: attachments/chips, skill picking, mode and
 *   permission controls belong to Evir's domain stores and existing
 *   composed components (SkillPicker, ModeSwitcher, PermissionSwitcher).
 * - PromptInputTextarea keeps the upstream IME-safe Enter-to-submit and
 *   field-sizing auto-grow; Evir additionally drives its own auto-resize
 *   effect for WebKit engines without field-sizing support.
 * Business semantics stay in Evir: submit → validate → accept/persist →
 * clear draft; the draft is preserved on failure.
 */
/* eslint-disable react-refresh/only-export-components -- vendored; useTextInput exports with components, as upstream */

import type { ChangeEvent, ComponentProps, FormEvent, HTMLAttributes, KeyboardEvent } from "react";
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "../../ui/utils";
import type { ChatStatus } from "./ai-types";

/* ------------------------------------------------------------------ */
/* Upstream root: controlled/uncontrolled text-input controller        */
/* ------------------------------------------------------------------ */

export interface TextInputContext {
  value: string;
  setInput: (value: string) => void;
}

const TextInputContext = createContext<TextInputContext | null>(null);

export function useTextInput() {
  const context = useContext(TextInputContext);
  if (!context) {
    throw new Error("TextInput components must be used within TextInput");
  }
  return context;
}

export type PromptInputProviderProps = HTMLAttributes<HTMLFormElement> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Optional controller so Evir's draft store (single source of truth) can
 * drive the textarea while the upstream composition stays intact.
 */
export function PromptInputProvider({
  value,
  onValueChange,
  children,
  ...props
}: PromptInputProviderProps) {
  const inputRef = useRef(value);
  inputRef.current = value;
  useEffect(() => {
    inputRef.current = value;
  }, [value]);
  const setInput = useCallback(
    (next: string) => {
      onValueChange(next);
    },
    [onValueChange],
  );
  return (
    <TextInputContext.Provider value={{ value: inputRef.current, setInput }}>
      <form {...props}>{children}</form>
    </TextInputContext.Provider>
  );
}

function useOptionalTextInput(): TextInputContext | null {
  return useContext(TextInputContext);
}

/* ------------------------------------------------------------------ */
/* Body / textarea / footer / tools                                    */
/* ------------------------------------------------------------------ */

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<"textarea">;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalTextInput();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Call the external onKeyDown handler first (Evir's slash palette and
      // IME guards live there).
      onKeyDown?.(e);

      // If the external handler prevented default, don't run internal logic
      if (e.defaultPrevented) {
        return;
      }

      if (e.key === "Enter") {
        if (isComposing || e.nativeEvent.isComposing) {
          return;
        }
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();

        // Check if the submit button is disabled before submitting
        const { form } = e.currentTarget;
        const submitButton = form?.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement | null;
        if (submitButton?.disabled) {
          return;
        }

        form?.requestSubmit();
      }
    },
    [onKeyDown, isComposing],
  );

  const handleCompositionEnd = useCallback(() => setIsComposing(false), []);
  const handleCompositionStart = useCallback(() => setIsComposing(true), []);

  const controlledProps = controller
    ? {
        onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
          controller.setInput(e.currentTarget.value);
          onChange?.(e);
        },
        value: controller.value,
      }
    : {
        onChange,
      };

  return (
    <textarea
      // InputGroupTextarea contract (upstream): the control marks itself so
      // the container can key its focus ring off it, and never draws its own
      // focus indicator — the container owns the visible focus state.
      data-slot="input-group-control"
      className={cn(
        "field-sizing-content max-h-48 min-h-16 w-full flex-1 resize-none rounded-none border-0 bg-transparent shadow-none outline-none focus-visible:ring-0",
        className,
      )}
      name="message"
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      {...props}
      {...controlledProps}
    />
  );
};

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  // Upstream renders the footer as InputGroupAddon align="block-end"
  // (w-full px-3 pb-3); the trimmed core subset keeps the same inset on the
  // footer itself since the form root is direct.
  <div
    className={cn("flex w-full items-center justify-between gap-1 px-3 pb-3", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex min-w-0 items-center gap-1", className)} {...props} />
);

export type PromptInputButtonTooltip =
  | string
  | {
      content: React.ReactNode;
      shortcut?: string;
      side?: "top" | "bottom";
    };

export type PromptInputButtonProps = ComponentProps<typeof Button> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  tooltip,
  ...props
}: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");

  const button = (
    <Button className={cn(className)} size={newSize} type="button" variant={variant} {...props} />
  );

  if (!tooltip) {
    return button;
  }

  const tooltipContent = typeof tooltip === "string" ? tooltip : tooltip.content;
  const shortcut = typeof tooltip === "string" ? undefined : tooltip.shortcut;
  const side = typeof tooltip === "string" ? "top" : (tooltip.side ?? "top");

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
};

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "primary",
  size = "sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitted" || status === "streaming";

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick],
  );

  return (
    <Button
      aria-label={isGenerating ? "Stop" : "Submit"}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={isGenerating ? "destructive" : variant}
      {...props}
    >
      {children ?? (status === "submitted" ? <Spinner /> : null)}
    </Button>
  );
};

/* ------------------------------------------------------------------ */
/* Form root (trimmed upstream PromptInput without attachments)        */
/* ------------------------------------------------------------------ */

export type PromptInputProps = Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export const PromptInput = ({ className, onSubmit, ...props }: PromptInputProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit(event);
  };

  // Upstream wraps children in shadcn's InputGroup, which carries the visible
  // container (rounded border, surface background, focus ring) and keys its
  // focus state off the control via `has-[[data-slot=input-group-control]:
  // focus-visible]`. The trimmed core subset renders the form directly, so the
  // container contract lives here with Evir tokens at a restrained level
  // (subtle border tint + light ring) instead of an InputGroup dependency.
  return (
    <form
      className={cn(
        "w-full rounded-xl border border-border bg-surface shadow-xs transition-[border-color,box-shadow] outline-none",
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring/50",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-[3px]",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20",
        "has-[[data-slot=input-group-control]:focus-visible]:shadow-sm",
        className,
      )}
      onSubmit={handleSubmit}
      {...props}
    />
  );
};
