import { useEffect, useState } from "react";

/**
 * Shared 60s clock (§38): one app-wide interval updates every subscriber, so
 * relative times stay fresh without per-row timers or per-second sidebar
 * repaints. Stale rows (dates beyond "yesterday") simply recompute to the same
 * string, which React skips cheaply.
 */
const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function ensureTimer() {
  if (timer !== null) return;
  timer = setInterval(() => {
    for (const listener of listeners) listener();
  }, TICK_MS);
}

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const listener = () => setNow(Date.now());
    listeners.add(listener);
    ensureTimer();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return now;
}
