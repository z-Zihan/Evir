// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteConversation = vi.fn<(id: string) => Promise<void>>();

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: () => ({
    conversations: [
      {
        id: "conversation-1",
        title: "产品讨论",
        providerId: "provider-1",
        modelId: "model-1",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    currentConversationId: null,
    selectConversation: vi.fn(),
    deleteConversation,
    renameConversation: vi.fn(),
    togglePin: vi.fn(),
  }),
}));

vi.mock("../../features/settings/personalization-settings", () => ({
  loadPersonalizationPreferences: vi.fn().mockResolvedValue({
    displayName: "",
    avatarColor: "sage",
    avatarImage: "",
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Sidebar", () => {
  it("requires confirmation before deleting a conversation", async () => {
    const { Sidebar } = await import("../Sidebar");
    render(<Sidebar onOpenSettings={vi.fn()} onNewConversation={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "provider.delete" }));
    expect(deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "provider.delete",
      }),
    );

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith("conversation-1"));
  });
});
