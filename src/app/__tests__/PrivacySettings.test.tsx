// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockClear = vi.fn(() => Promise.resolve());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: () => ({ privateSession: false, togglePrivateSession: vi.fn() }),
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
    transaction: (...args: unknown[]) => {
      const fn = args[args.length - 1];
      return typeof fn === "function" ? (fn as () => Promise<void>)() : Promise.resolve();
    },
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

  it("renders the private session toggle", async () => {
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    expect(screen.getByText("chat.privateSession")).toBeDefined();
    expect(screen.getByLabelText("chat.privateSession")).toBeDefined();
  });

  it("does not clear when confirmation is cancelled", async () => {
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    fireEvent.click(screen.getByText("privacy.clearConversations"));
    expect(screen.getByRole("alertdialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "confirmation.cancel" }));
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("clears conversations only after confirmation", async () => {
    const { PrivacySettings } = await import("../PrivacySettings");
    render(<PrivacySettings />);

    fireEvent.click(screen.getByText("privacy.clearConversations"));
    expect(mockClear).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "privacy.clearConversations",
      }),
    );
    await vi.waitFor(() => {
      expect(mockClear).toHaveBeenCalled();
    });
  });
});
