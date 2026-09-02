import { Toolbar as ToolbarPrimitive } from "@base-ui-components/react/toolbar";
import type { ComponentProps } from "react";

import { cn } from "./utils";

export function Toolbar({ className, ...props }: ComponentProps<typeof ToolbarPrimitive.Root>) {
  return <ToolbarPrimitive.Root className={cn("flex items-center gap-1", className)} {...props} />;
}

export const ToolbarButton = ToolbarPrimitive.Button;
export const ToolbarInput = ToolbarPrimitive.Input;
export const ToolbarLink = ToolbarPrimitive.Link;
export const ToolbarSeparator = ToolbarPrimitive.Separator;
export const ToolbarGroup = ToolbarPrimitive.Group;
