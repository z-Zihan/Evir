// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteMemory = vi.fn<(id: string) => Promise<void>>();

vi.mock("../../features/memory/memory-store", () => ({
  useMemoryStore: () => ({
    memories: [
      {
        id: "memory-1",
        type: "conversation",
        scope: "global",
        key: "项目偏好",
        content: "使用中文回答",
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
      },
    ],
    loadMemories: vi.fn().mockResolvedValue(undefined),
    addMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory,
    togglePin: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemorySettings", () => {
  it("requires confirmation before deleting a memory", async () => {
    const { MemorySettings } = await import("../MemorySettings");
    render(<MemorySettings conversationId={null} />);

    fireEvent.click(screen.getByRole("button", { name: "memory.delete" }));
    expect(deleteMemory).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "memory.delete" }),
    );

    await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith("memory-1"));
  });
});
