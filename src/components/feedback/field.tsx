import { Field as FieldPrimitive } from "@base-ui-components/react/field";
import type { ComponentProps } from "react";
import { cn } from "../ui/utils";

/**
 * FormField (§19): shared Label/Description/Control/Error wiring on Base UI's
 * Field primitive. A11y attributes (aria-describedby, aria-invalid) are
 * connected by the primitive; callers only supply content.
 */
export const FormField = FieldPrimitive.Root;

export function FormLabel({ className, ...props }: ComponentProps<typeof FieldPrimitive.Label>) {
  return (
    <FieldPrimitive.Label
      className={cn("text-[12.5px] font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function FormDescription({
  className,
  ...props
}: ComponentProps<typeof FieldPrimitive.Description>) {
  return (
    <FieldPrimitive.Description
      className={cn("text-[11.5px] leading-relaxed text-muted", className)}
      {...props}
    />
  );
}

export function FormError({ className, ...props }: ComponentProps<typeof FieldPrimitive.Error>) {
  return <FieldPrimitive.Error className={cn("text-[11.5px] text-danger", className)} {...props} />;
}

export const FormControl = FieldPrimitive.Control;

/** Standard vertical layout for one settings/form row's field block. */
export function FieldBlock({ className, ...props }: ComponentProps<typeof FieldPrimitive.Root>) {
  return <FormField className={cn("flex flex-col gap-1.5", className)} {...props} />;
}
