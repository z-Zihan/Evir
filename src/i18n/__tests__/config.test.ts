// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Default language rule: stored `evir-language` wins, otherwise English. The
 * browser language is intentionally ignored.
 */
describe("i18n initial language", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    Object.defineProperty(globalThis.navigator, "language", {
      configurable: true,
      value: "zh-CN",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to English even when the browser language is Chinese", async () => {
    const { default: i18n } = await import("../config");
    expect(i18n.language).toBe("en");
  });

  it("honors a stored language choice", async () => {
    localStorage.setItem("evir-language", "zh-CN");
    const { default: i18n } = await import("../config");
    expect(i18n.language).toBe("zh-CN");
  });
});
