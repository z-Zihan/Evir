import { Dialog as DialogPrimitive } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/** Side drawer built on the Dialog primitive — for small-window layout degradation. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  side = "right",
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & {
  side?: "left" | "right" | "bottom";
  showCloseButton?: boolean;
}) {
  const sideClasses = {
    left: "top-0 left-0 h-full w-80 max-w-[85vw] border-r data-[starting-style]:-translate-x-4",
    right: "top-0 right-0 h-full w-80 max-w-[85vw] border-l data-[starting-style]:translate-x-4",
    bottom:
      "bottom-0 left-0 w-full max-h-[85vh] border-t rounded-t-2xl data-[starting-style]:translate-y-4",
  } as const;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Popup
        className={cn(
          "fixed z-[200] flex flex-col gap-3 border-border bg-surface p-4 text-foreground shadow-dialog transition-[transform,opacity] duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <X size={14} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
