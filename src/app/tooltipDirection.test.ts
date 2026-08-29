// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTooltipDirection,
  installTooltipDirection,
  nearestClipTop,
  UPWARD_CLEARANCE,
} from "./tooltipDirection";

function buildTree(
  containerTop: number,
  hostTop: number,
): { container: HTMLDivElement; host: HTMLButtonElement } {
  const container = document.createElement("div");
  // jsdom does not resolve overflow through getComputedStyle; expose the
  // inline value through a proxy so the clipping-ancestor walk sees it.
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    if (el !== container) return style;
    return new Proxy(style, {
      get(target, property) {
        if (property === "overflow" || property === "overflowX" || property === "overflowY")
          return "auto";
        const value: unknown = Reflect.get(target, property, style);
        return typeof value === "function" ? (value.bind(style) as unknown) : value;
      },
    });
  });
  container.getBoundingClientRect = () => ({
    top: containerTop,
    bottom: 800,
    left: 0,
    right: 400,
    width: 400,
    height: 800 - containerTop,
    x: 0,
    y: containerTop,
    toJSON: () => ({}),
  });
  const host = document.createElement("button");
  host.setAttribute("data-tip", "demo");
  host.getBoundingClientRect = () => ({
    top: hostTop,
    bottom: hostTop + 32,
    left: 10,
    right: 42,
    width: 32,
    height: 32,
    x: 10,
    y: hostTop,
    toJSON: () => ({}),
  });
  container.appendChild(host);
  document.body.appendChild(container);
  return { container, host };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nearestClipTop", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the viewport top of the first scrolling/clipping ancestor", () => {
    const { host } = buildTree(134, 140);
    expect(nearestClipTop(host)).toBe(134);
  });

  it("falls back to the window top when no ancestor clips", () => {
    const plain = document.createElement("div");
    const host = document.createElement("button");
    plain.appendChild(host);
    document.body.appendChild(plain);
    expect(nearestClipTop(host)).toBe(0);
  });
});

describe("applyTooltipDirection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("flips below when the upward clearance inside the clipper is too small", () => {
    const { host } = buildTree(134, 140);
    applyTooltipDirection(host);
    expect(host.dataset.tipDir).toBe("below");
  });

  it("keeps the default upward bubble when clearance is sufficient", () => {
    const { host } = buildTree(0, 300);
    applyTooltipDirection(host);
    expect(host.dataset.tipDir).toBeUndefined();
  });

  it("clears a stale below flag once clearance is restored", () => {
    const { host } = buildTree(134, 140);
    applyTooltipDirection(host);
    host.getBoundingClientRect = () => ({
      top: 400,
      bottom: 432,
      left: 10,
      right: 42,
      width: 32,
      height: 32,
      x: 10,
      y: 400,
      toJSON: () => ({}),
    });
    applyTooltipDirection(host);
    expect(host.dataset.tipDir).toBeUndefined();
  });

  it("ignores elements without a tooltip", () => {
    const { host } = buildTree(134, 140);
    host.removeAttribute("data-tip");
    applyTooltipDirection(host);
    expect(host.dataset.tipDir).toBeUndefined();
  });
});

describe("installTooltipDirection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("measures on pointerover of a tip host and cleans up on teardown", () => {
    const { host } = buildTree(134, 140);
    const cleanup = installTooltipDirection();
    host.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(host.dataset.tipDir).toBe("below");
    cleanup();
    delete host.dataset.tipDir;
    host.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(host.dataset.tipDir).toBeUndefined();
  });

  it("measures on keyboard focus", () => {
    const { host } = buildTree(0, 8);
    const cleanup = installTooltipDirection();
    host.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(host.dataset.tipDir).toBe("below");
    cleanup();
  });

  it("resolves the host when pointerover targets an inner icon element", () => {
    const { host } = buildTree(134, 140);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "path");
    host.appendChild(icon);
    const cleanup = installTooltipDirection();
    icon.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(host.dataset.tipDir).toBe("below");
    cleanup();
  });

  it("exposes a positive clearance budget", () => {
    expect(UPWARD_CLEARANCE).toBeGreaterThan(0);
  });
});
