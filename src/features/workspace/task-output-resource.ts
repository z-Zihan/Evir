import { logger } from "../../core/logging/logger";
import { resolveWorkspacePath } from "./workspace-services";
import { useWorkspacePanelStore } from "./workspace-panel-store";
import type { TaskOutput } from "./task-output-model";

/**
 * Open a task output in the preview pane — the single mapping shared by the
 * Outputs tab rows (§22) and the `/recent` slash action, so both surfaces
 * route screenshots/canvas/files identically.
 */
export function openTaskOutput(output: TaskOutput, root: string | null): void {
  const { openResource } = useWorkspacePanelStore.getState();
  const withEvent = <R>(open: (resource: R) => void, resource: R): void => {
    logger.info("ui", "ui.output.open", {
      actionId: crypto.randomUUID(),
      resourceId: JSON.stringify(resource).slice(0, 120),
    });
    open(resource);
  };
  if (output.kind === "screenshot") {
    const label = output.path.split("/").pop();
    withEvent(openResource, {
      kind: "screenshot" as const,
      path: output.path,
      ...(label ? { label } : {}),
    });
    return;
  }
  if (output.kind === "canvas") {
    withEvent(openResource, { kind: "canvas" as const, path: output.path });
    return;
  }
  const path = resolveWorkspacePath(output.path, root);
  if (!path) return;
  withEvent(openResource, {
    kind: "file",
    path,
    ...(output.mimeType ? { mimeType: output.mimeType } : {}),
  });
}

/** Absolute path for copy/reveal actions; null where none applies. */
export function taskOutputAbsolutePath(output: TaskOutput, root: string | null): string | null {
  if (output.kind === "screenshot") return output.path;
  if (output.kind === "canvas") return resolveWorkspacePath(output.path, root);
  return resolveWorkspacePath(output.path, root);
}
