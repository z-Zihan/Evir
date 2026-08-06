// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockClear = vi.fn(() => Promise.resolve());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../core/storage/db", () => ({
  db: {
    conversations: { clear: mockClear },
    messages: { clear: mockClear },
    attachments: { clear: mockClear },
    providers: { clear: mockClear },
    usage_records: { clear: mockClear },
    mcpServers: { clear: mockClear },
    settings: { clear: mockClear },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PrivacySettings", () => {
  it("renders all 5 clear buttons", async () => {
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    expect(screen.getByText("privacy.clearConversations")).toBeDefined();
    expect(screen.getByText("privacy.clearProviders")).toBeDefined();
    expect(screen.getByText("privacy.clearUsage")).toBeDefined();
    expect(screen.getByText("privacy.clearMcp")).toBeDefined();
    expect(screen.getByText("privacy.clearAll")).toBeDefined();
  });

  it("shows warning message", async () => {
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    expect(screen.getByText("privacy.confirmClear")).toBeDefined();
  });

  it("does not clear when confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    fireEvent.click(screen.getByText("privacy.clearConversations"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("clears conversations when confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    fireEvent.click(screen.getByText("privacy.clearConversations"));
    await vi.waitFor(() => {
      expect(mockClear).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
  });
});
