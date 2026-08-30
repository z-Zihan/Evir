import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "evir-sidebar-width";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 252;

function clampWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? clampWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
}

/**
 * Drag-to-resize for the sidebar column. The returned ref goes on the thin
 * drag handle at the sidebar's right edge; the width state feeds the shell
 * grid via the --sidebar-width custom property.
 */
export function useSidebarResize(): {
  width: number;
  resizing: boolean;
  reset: () => void;
  handleProps: {
    ref: React.RefObject<HTMLDivElement | null>;
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
} {
  const [width, setWidth] = useState<number>(() => readStoredWidth());
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
      startWidth: readStoredWidth(),
    };
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: PointerEvent): void => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = event.clientX - drag.startClientX;
      setWidth(clampWidth(drag.startWidth + delta));
    };
    const onUp = (event: PointerEvent): void => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragState.current = null;
      setResizing(false);
      setWidth((current) => {
        window.localStorage.setItem(STORAGE_KEY, String(current));
        return current;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing]);

  const handleRef = useRef<HTMLDivElement | null>(null);
  const reset = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, String(SIDEBAR_DEFAULT_WIDTH));
    setWidth(SIDEBAR_DEFAULT_WIDTH);
  }, []);
  return { width, resizing, reset, handleProps: { ref: handleRef, onPointerDown } };
}
