import { useEffect } from "react";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";

/**
 * Full-screen overlays render in the DOM, but the workspace browser's
 * content webviews are native views floating above it. Every full-screen
 * overlay registers itself so the browser surface hides while it is open.
 */
export function useOverlayBrowserGuard(key: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    useWorkspacePanelStore.getState().setOverlayBlocked(key, true);
    return () => {
      useWorkspacePanelStore.getState().setOverlayBlocked(key, false);
    };
  }, [key, active]);
}
