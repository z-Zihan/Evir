import { useEffect, useRef } from "react";
import type { ProjectRecord } from "../core/storage/db";

/**
 * The projects section scrolls internally (max-height cap), so a newly added
 * project can land outside the visible area and appear "lost". When the
 * project list grows, scroll the newest addition into view.
 */
export function useScrollNewProjectIntoView(
  projects: ProjectRecord[],
): React.RefObject<HTMLElement | null> {
  const previousCount = useRef(projects.length);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const grew = projects.length > previousCount.current;
    previousCount.current = projects.length;
    if (!grew || projects.length === 0) return;
    const newest = projects.reduce((a, b) =>
      (b.lastOpenedAt ?? 0) > (a.lastOpenedAt ?? 0) ? b : a,
    );
    // The container scroll happens after paint of the new row; wait a frame.
    const frame = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-project-id="${newest.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [projects]);

  return containerRef;
}
