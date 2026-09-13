import { resolveWorkspacePath } from "../workspace/workspace-services";
import { CANVAS_EXTENSION } from "./canvas-document";

/**
 * Shared canvas path helpers (CAN-1/CAN-2): the agent tools accept a
 * workspace-relative or absolute `path` and append `.evir-canvas` when
 * missing — the UI needs the same normalization to match tool events
 * against an open document or to focus the canvas tab.
 */

/** Is this tool call a successful canvas write the UI should react to? */
export function isCanvasToolName(toolName: string): boolean {
  return toolName === "update_canvas" || toolName === "create_canvas";
}

/** Normalize a canvas tool-call `path` argument to the workspace absolute
 * path, or null when the argument is not a usable string. */
export function resolveCanvasToolPath(
  args: Record<string, unknown>,
  root: string | null,
): string | null {
  const raw = args.path;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const withExtension = raw.toLowerCase().endsWith(CANVAS_EXTENSION)
    ? raw
    : `${raw}${CANVAS_EXTENSION}`;
  return resolveWorkspacePath(withExtension, root);
}
