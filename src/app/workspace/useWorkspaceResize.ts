import { useCallback, useEffect, useRef, useState } from "react";
import {
  useWorkspacePanelStore,
  WORKSPACE_DEFAULT_WIDTH,
  WORKSPACE_MAX_WIDTH_RATIO,
  WORKSPACE_MIN_WIDTH,
} from "../../features/workspace/workspace-panel-store";

function clampWidth(value: number): number {
  const viewportMax =
    typeof window === "undefined"
      ? 1600
      : Math.max(WORKSPACE_MIN_WIDTH, Math.floor(window.innerWidth * WORKSPACE_MAX_WIDTH_RATIO));
  return Math.min(viewportMax, Math.max(WORKSPACE_MIN_WIDTH, Math.round(value)));
}

/**
 * Drag-to-resize for the workspace panel. Dragging left widens the panel;
 * double-click on the divider restores the default width (§28). The width
 * persists through the panel store, not local state, so the CSS variable
 * stays consistent wherever the shell reads it.
 */
export function useWorkspaceResize(): {
  resizing: boolean;
  reset: () => void;
  handleProps: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
} {
  const setWidth = useWorkspacePanelStore((state) => state.setWidth);
  const width = useWorkspacePanelStore((state) => state.width);
  const [resizing, setResizing] = useState(false);
  const dragState = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(
    null,
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: useWorkspacePanelStore.getState().width,
    };
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: PointerEvent): void => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = drag.startClientX - event.clientX;
      setWidth(clampWidth(drag.startWidth + delta));
    };
    const onUp = (event: PointerEvent): void => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragState.current = null;
      setResizing(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing, setWidth]);

  const reset = useCallback(() => {
    setWidth(WORKSPACE_DEFAULT_WIDTH);
  }, [setWidth]);

  // Keep the persisted width within bounds when the viewport shrinks.
  useEffect(() => {
    const handleResize = () => {
      if (width > clampWidth(width)) setWidth(clampWidth(width));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setWidth, width]);

  return { resizing, reset, handleProps: { onPointerDown } };
}
