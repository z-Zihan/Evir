// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

type MediaListener = (event: { matches: boolean }) => void;

class FakeMediaQuery {
  matches = false;
  private readonly listeners = new Set<MediaListener>();
  addEventListener(_type: string, listener: MediaListener): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: MediaListener): void {
    this.listeners.delete(listener);
  }
  setDark(dark: boolean): void {
    this.matches = dark;
    for (const listener of this.listeners) listener({ matches: dark });
  }
}

const media = new FakeMediaQuery();
vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation(() => media),
);

// The store calls matchMedia at module scope, so it must load after the stub.
const { useThemeStore } = await import("../theme-store");

afterEach(() => {
  document.documentElement.className = "";
  localStorage.clear();
  useThemeStore.setState({ theme: "system" });
  media.setDark(false);
});

describe("theme system hot-reload", () => {
  it("follows OS appearance changes while theme is system", () => {
    media.setDark(false);
    useThemeStore.getState().setTheme("system");
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    media.setDark(true);
    expect(useThemeStore.getState().resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ignores OS appearance changes once an explicit theme is chosen", () => {
    useThemeStore.getState().setTheme("light");
    media.setDark(true);
    expect(useThemeStore.getState().resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
