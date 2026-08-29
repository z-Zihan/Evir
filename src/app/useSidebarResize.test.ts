// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarResize,
} from "./useSidebarResize";

describe("useSidebarResize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at the default width when nothing is stored", () => {
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("restores a previously stored width", () => {
    localStorage.setItem("evir-sidebar-width", "320");
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.width).toBe(320);
  });

  it("clamps out-of-range stored values into the allowed range", () => {
    localStorage.setItem("evir-sidebar-width", "800");
    const first = renderHook(() => useSidebarResize());
    expect(first.result.current.width).toBe(SIDEBAR_MAX_WIDTH);

    localStorage.setItem("evir-sidebar-width", "50");
    const second = renderHook(() => useSidebarResize());
    expect(second.result.current.width).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("tracks pointer drag and persists the final width on release", () => {
    const { result } = renderHook(() => useSidebarResize());
    expect(result.current.resizing).toBe(false);

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        pointerId: 7,
        clientX: 252,
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.resizing).toBe(true);

    act(() => {
      const move = new MouseEvent("pointermove", { clientX: 352 });
      Object.defineProperty(move, "pointerId", { value: 7 });
      window.dispatchEvent(move);
    });
    expect(result.current.width).toBe(352);

    // Beyond the maximum the width clamps instead of overflowing.
    act(() => {
      const move = new MouseEvent("pointermove", { clientX: 900 });
      Object.defineProperty(move, "pointerId", { value: 7 });
      window.dispatchEvent(move);
    });
    expect(result.current.width).toBe(SIDEBAR_MAX_WIDTH);

    act(() => {
      const up = new MouseEvent("pointerup");
      Object.defineProperty(up, "pointerId", { value: 7 });
      window.dispatchEvent(up);
    });
    expect(result.current.resizing).toBe(false);
    expect(localStorage.getItem("evir-sidebar-width")).toBe(String(SIDEBAR_MAX_WIDTH));
  });

  it("ignores non-primary-button pointer downs", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => {
      result.current.handleProps.onPointerDown({
        button: 2,
        pointerId: 1,
        clientX: 252,
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.resizing).toBe(false);
  });
});
