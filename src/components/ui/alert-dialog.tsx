import { AlertDialog as AlertDialogPrimitive } from "@base-ui-components/react/alert-dialog";
import type { ComponentProps } from "react";

import { cn } from "./utils";
import { buttonVariants } from "./button";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Popup>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-[220] bg-black/40 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <AlertDialogPrimitive.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-[220] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 text-foreground shadow-dialog transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-[15px] leading-tight font-semibold", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("mt-1.5 text-[12.5px] text-muted", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function AlertDialogAction({ className, ...props }: ComponentProps<"button">) {
  return <button className={cn(buttonVariants({ variant: "primary" }), className)} {...props} />;
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Close>) {
  return (
    <AlertDialogPrimitive.Close
      className={cn(buttonVariants({ variant: "secondary" }), className)}
      {...props}
    />
  );
}
