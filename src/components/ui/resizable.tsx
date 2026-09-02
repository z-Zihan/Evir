import { Group, Panel, Separator } from "react-resizable-panels";
import type { ComponentProps } from "react";

import { cn } from "./utils";

/**
 * Shell resizing (react-resizable-panels v4: Group/Panel/Separator). The app
 * shell maps Sidebar / Conversation / Workbench onto this — replaces the two
 * hand-rolled pointer-drag resizer hooks. Separators bring keyboard resize and
 * double-click-to-default for free; persistence via useDefaultLayout.
 */
export const ResizableGroup = Group;
export const ResizablePanel = Panel;

export function ResizableHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "relative w-px shrink-0 cursor-col-resize bg-transparent transition-colors outline-none hover:bg-border-strong focus-visible:bg-focus data-[active]:bg-focus after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']",
        className,
      )}
      {...props}
    />
  );
}

export { useDefaultLayout } from "react-resizable-panels";
