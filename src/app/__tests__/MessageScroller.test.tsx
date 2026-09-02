// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AT_BOTTOM_THRESHOLD_PX,
  MessageScroller,
  shouldAttachToBottom,
  shouldShowJumpButton,
  type MessageScrollerHandle,
} from "../MessageScroller";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

afterEach(cleanup);

interface ScrollLayout {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** jsdom has no layout engine: pin scroll metrics on the element instance. */
function pinLayout(element: HTMLElement, layout: ScrollLayout): void {
  for (const [property, value] of Object.entries(layout)) {
    Object.defineProperty(element, property, { configurable: true, value });
  }
}

/** jsdom lacks Element.scrollTo: stub it on the instance and record calls. */
function stubScrollTo(element: HTMLElement): ReturnType<typeof vi.fn> {
  const scrollTo = vi.fn();
  Object.defineProperty(element, "scrollTo", { configurable: true, value: scrollTo });
  return scrollTo;
}

interface RenderScrollerResult {
  scroller: HTMLElement;
  scrollTo: ReturnType<typeof vi.fn>;
  rerender: (ui: ReactElement) => void;
  handleRef: React.RefObject<MessageScrollerHandle | null>;
}

function renderScroller(streamKey: number | string = 0): RenderScrollerResult {
  const handleRef = createRef<MessageScrollerHandle>();
  const utils = render(
    <MessageScroller ref={handleRef} streamKey={streamKey} className="messages-area">
      <p>message-child</p>
    </MessageScroller>,
  );
  const found = utils.container.querySelector(".messages-area");
  if (!(found instanceof HTMLElement)) throw new Error("scroller element missing");
  const scroller: HTMLElement = found;
  const scrollTo = stubScrollTo(scroller);
  return {
    scroller,
    scrollTo,
    rerender: utils.rerender,
    handleRef,
  };
}

describe("shouldAttachToBottom", () => {
  it("attaches at or inside the threshold", () => {
    expect(shouldAttachToBottom(0)).toBe(true);
    expect(shouldAttachToBottom(AT_BOTTOM_THRESHOLD_PX - 1)).toBe(true);
  });

  it("detaches beyond the threshold (matches the historical < 80 rule)", () => {
    expect(shouldAttachToBottom(AT_BOTTOM_THRESHOLD_PX)).toBe(false);
    expect(shouldAttachToBottom(500)).toBe(false);
  });
});

describe("shouldShowJumpButton", () => {
  it("shows only when follow is detached AND content overflows", () => {
    expect(shouldShowJumpButton(false, true)).toBe(true);
    expect(shouldShowJumpButton(true, true)).toBe(false);
    expect(shouldShowJumpButton(false, false)).toBe(false);
    expect(shouldShowJumpButton(true, false)).toBe(false);
  });
});

describe("MessageScroller rendering", () => {
  it("renders children in the same messages-area class and hides the pill while attached", () => {
    renderScroller();
    expect(screen.getByText("message-child")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "chat.jumpToLatest" })).toBeNull();
  });

  it("follows streamKey changes while attached", async () => {
    const { scrollTo, rerender } = renderScroller("0");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    rerender(
      <MessageScroller streamKey="1" className="messages-area">
        <p>message-child</p>
      </MessageScroller>,
    );
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
  });

  it("reports at-bottom metrics through onScrollMetrics", () => {
    const onScrollMetrics = vi.fn();
    const handleRef = createRef<MessageScrollerHandle>();
    const utils = render(
      <MessageScroller ref={handleRef} streamKey={0} onScrollMetrics={onScrollMetrics}>
        <p>message-child</p>
      </MessageScroller>,
    );
    const scroller = utils.container.firstElementChild;
    if (!(scroller instanceof HTMLElement)) throw new Error("scroller element missing");
    stubScrollTo(scroller);
    pinLayout(scroller, { scrollTop: 0, scrollHeight: 400, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(onScrollMetrics).toHaveBeenLastCalledWith(true);
    pinLayout(scroller, { scrollTop: 40, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(onScrollMetrics).toHaveBeenLastCalledWith(false);
  });
});

describe("MessageScroller follow and jump", () => {
  it("detaches on upward user scroll, shows the pill, and re-attaches on click", async () => {
    const { scroller, scrollTo } = renderScroller();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));

    // Scroll downward while far from the bottom: follow must NOT break
    // (only upward scrolls detach).
    pinLayout(scroller, { scrollTop: 300, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("button", { name: "chat.jumpToLatest" })).toBeNull();

    // Scroll upward beyond the threshold: detach, overflow -> pill appears.
    pinLayout(scroller, { scrollTop: 120, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "chat.jumpToLatest" })).toBeTruthy();

    // Click jumps smoothly and re-attaches (pill hides).
    fireEvent.click(screen.getByRole("button", { name: "chat.jumpToLatest" }));
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: "smooth" }),
    );
    expect(screen.queryByRole("button", { name: "chat.jumpToLatest" })).toBeNull();
  });

  it("re-attaches when the user scrolls back to the bottom", async () => {
    const { scroller, scrollTo } = renderScroller();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    pinLayout(scroller, { scrollTop: 500, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    pinLayout(scroller, { scrollTop: 200, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "chat.jumpToLatest" })).toBeTruthy();

    pinLayout(scroller, { scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("button", { name: "chat.jumpToLatest" })).toBeNull();
  });
});

describe("MessageScrollerHandle", () => {
  it("force-scrolls even while detached and re-attaches follow", async () => {
    const { scroller, scrollTo, handleRef } = renderScroller();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    pinLayout(scroller, { scrollTop: 500, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    pinLayout(scroller, { scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "chat.jumpToLatest" })).toBeTruthy();

    const handle = handleRef.current;
    if (!handle) throw new Error("handle missing");
    handle.scrollToBottom(true);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: "auto" });
    expect(screen.queryByRole("button", { name: "chat.jumpToLatest" })).toBeNull();
  });

  it("ignores non-forced scrollToBottom while detached", async () => {
    const { scroller, scrollTo, handleRef } = renderScroller();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    pinLayout(scroller, { scrollTop: 500, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);
    pinLayout(scroller, { scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    fireEvent.scroll(scroller);

    const handle = handleRef.current;
    if (!handle) throw new Error("handle missing");
    handle.scrollToBottom();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
