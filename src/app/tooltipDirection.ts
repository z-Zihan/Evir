/*
 * Direction pass for the CSS-only [data-tip] tooltip system. The stylesheet
 * always opens the bubble upward; a host sitting near the top of its clipping
 * ancestor (scroll list first row, window-top header buttons) would have the
 * bubble cut off. On hover/focus we measure that clearance once and flag the
 * host with data-tip-dir="below"; the CSS flips the anchor accordingly.
 */

const CLIPPING_OVERFLOW = new Set(["hidden", "auto", "scroll", "clip"]);

/** Bubble height estimate plus the 6px offset — clearance required to open upward. */
export const UPWARD_CLEARANCE = 40;

export function nearestClipTop(el: HTMLElement): number {
  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    if (CLIPPING_OVERFLOW.has(style.overflowX) || CLIPPING_OVERFLOW.has(style.overflowY)) {
      return Math.max(0, node.getBoundingClientRect().top);
    }
    node = node.parentElement;
  }
  return 0;
}

export function applyTooltipDirection(target: HTMLElement): void {
  if (!target.hasAttribute("data-tip")) return;
  const spaceAbove = target.getBoundingClientRect().top - nearestClipTop(target);
  if (spaceAbove < UPWARD_CLEARANCE) {
    target.dataset.tipDir = "below";
  } else {
    delete target.dataset.tipDir;
  }
}

function tipHostFrom(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  // pointerover usually targets the icon inside the button, not the host.
  const host = node.closest("[data-tip]");
  return host instanceof HTMLElement ? host : null;
}

/** Delegated listeners; returns a cleanup function. */
export function installTooltipDirection(): () => void {
  const onOver = (event: PointerEvent): void => {
    const host = tipHostFrom(event.target);
    if (host) applyTooltipDirection(host);
  };
  const onFocus = (event: FocusEvent): void => {
    const host = tipHostFrom(event.target);
    if (host) applyTooltipDirection(host);
  };
  document.addEventListener("pointerover", onOver);
  document.addEventListener("focusin", onFocus);
  return () => {
    document.removeEventListener("pointerover", onOver);
    document.removeEventListener("focusin", onFocus);
  };
}
