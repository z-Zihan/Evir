// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("../notify", () => ({ notify: notifyMock }));
vi.mock("../../../i18n/config", () => ({
  default: { t: (key: string) => key },
}));

import { copyTextWithFeedback } from "../copy";

function stubClipboard(impl?: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("copyTextWithFeedback", () => {
  it("writes to the clipboard and toasts success", async () => {
    const writeText = stubClipboard();

    const ok = await copyTextWithFeedback("hello");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(notifyMock.success).toHaveBeenCalledWith("notify.copySuccess");
  });

  it("honors custom i18n keys for domain-specific copies", async () => {
    stubClipboard();
    await copyTextWithFeedback("/tmp/logs", { successKey: "diagnostics.logDirectoryCopied" });
    expect(notifyMock.success).toHaveBeenCalledWith("diagnostics.logDirectoryCopied");
  });

  it("toasts an error when the clipboard write rejects", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));

    const ok = await copyTextWithFeedback("hello");

    expect(ok).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledWith("notify.copyFailed");
    expect(notifyMock.success).not.toHaveBeenCalled();
  });

  it("fails gracefully when the clipboard API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });

    const ok = await copyTextWithFeedback("hello");

    expect(ok).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledWith("notify.copyFailed");
  });
});
