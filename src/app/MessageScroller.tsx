import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine } from "lucide-react";

/** Distance (px) from the content bottom within which the scroller counts as "at the bottom". */
export const AT_BOTTOM_THRESHOLD_PX = 80;

/**
 * True when the viewport is within the threshold of the content bottom.
 * Pure decision helper (jsdom has no layout, so the meaningful unit tests
 * live here rather than on scroll pixels).
 */
export function shouldAttachToBottom(distance: number): boolean {
  return distance < AT_BOTTOM_THRESHOLD_PX;
}

/**
 * The jump pill only makes sense while follow is detached AND the content
 * actually overflows — otherwise it would float over non-scrollable content.
 */
export function shouldShowJumpButton(attached: boolean, overflow: boolean): boolean {
  return !attached && overflow;
}

export interface MessageScrollerHandle {
  /**
   * Scrolls to the bottom. Without `force` it only scrolls while the
   * scroller is following the stream (never yanks a reading user down).
   */
  scrollToBottom: (force?: boolean) => void;
}

interface MessageScrollerProps {
  /** Bump whenever new content arrives (messages, stream deltas, layout changes). */
  streamKey: number | string;
  children: ReactNode;
  className?: string;
  /** Optional observer for at-bottom transitions (display-only state reports). */
  onScrollMetrics?: (atBottom: boolean) => void;
}

/**
 * Presentational scroll owner for the conversation. Owns ONLY display/scroll
 * state (follow flag, overflow flag, jump pill); never messages, runs, or
 * tool state — those arrive as `children` and content changes are signaled
 * by bumping `streamKey` from the owner (ChatView).
 */
export const MessageScroller = forwardRef<MessageScrollerHandle, MessageScrollerProps>(
  function MessageScroller({ streamKey, children, className, onScrollMetrics }, ref) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    // Follow starts attached so conversations open scrolled to the latest
    // message (history restore).
    const [attached, setAttached] = useState(true);
    const [overflow, setOverflow] = useState(false);
    const attachedRef = useRef(true);
    const lastScrollTopRef = useRef(0);

    const scrollToBottom = useCallback((force = false) => {
      if (!force && !attachedRef.current) return;
      attachedRef.current = true;
      setAttached(true);
      // Pretend the previous position was above us so the programmatic
      // scroll's own events can never read as "user scrolled up" and detach.
      lastScrollTopRef.current = 0;
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        element?.scrollTo({ top: element.scrollHeight, behavior: "auto" });
      });
    }, []);

    const jumpToLatest = useCallback(() => {
      attachedRef.current = true;
      setAttached(true);
      lastScrollTopRef.current = 0;
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        element?.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      });
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    const handleScroll = useCallback(() => {
      const element = scrollRef.current;
      if (!element) return;
      const previousTop = lastScrollTopRef.current;
      lastScrollTopRef.current = element.scrollTop;
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      const atBottom = shouldAttachToBottom(distance);
      const scrolledUp = element.scrollTop < previousTop;
      // Reaching the bottom by any means re-follows; only an upward scroll
      // may detach — programmatic frames (auto follow, smooth jump) move
      // downward, so they can never break follow or flash the pill.
      let next = attachedRef.current;
      if (atBottom) next = true;
      else if (scrolledUp) next = false;
      if (next !== attachedRef.current) {
        attachedRef.current = next;
        setAttached(next);
      }
      const nextOverflow = element.scrollHeight > element.clientHeight;
      setOverflow((current) => (current === nextOverflow ? current : nextOverflow));
      onScrollMetrics?.(atBottom);
    }, [onScrollMetrics]);

    // Stream follow: content changes only scroll while following.
    useEffect(() => {
      scrollToBottom();
    }, [streamKey, scrollToBottom]);

    const showJump = shouldShowJumpButton(attached, overflow);

    return (
      <div ref={scrollRef} className={className} onScroll={handleScroll}>
        {children}
        {showJump && (
          <div className="jump-to-latest-anchor">
            <button
              type="button"
              className="jump-to-latest"
              onClick={jumpToLatest}
              aria-label={t("chat.jumpToLatest")}
            >
              <ArrowDownToLine size={12} aria-hidden="true" />
              {t("chat.jumpToLatest")}
            </button>
          </div>
        )}
      </div>
    );
  },
);
