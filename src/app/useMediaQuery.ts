import { useEffect, useState } from "react";

/**
 * Reactive matchMedia. Used for the shell drawer breakpoints whose CSS
 * counterparts live in shell.css — the JS gate decides which columns render
 * inside the resizable Group, the media rules style the fixed drawers.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const handleViewportChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    // Re-sync in case the query result changed between render and effect.
    setMatches(list.matches);
    list.addEventListener("change", handleViewportChange);
    return () => list.removeEventListener("change", handleViewportChange);
  }, [query]);

  return matches;
}
