// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateMemoryInput } from "../../core/memory/types";

const deleteMemory = vi.fn<(id: string) => Promise<void>>();
const addMemory = vi.fn<(input: CreateMemoryInput) => Promise<string>>(() =>
  Promise.resolve("memory-2"),
);
const setMemoryEnabled = vi.fn(() => Promise.resolve());

vi.mock("../../features/memory/memory-store", () => ({
  useMemoryStore: () => ({
    memories: [
      {
        id: "memory-1",
        type: "conversation",
        scope: "global",
        key: "项目偏好",
        content: "使用中文回答",
        source: { kind: "manual", messageIds: [] },
        confidence: 1,
        sensitivity: "standard",
        enabled: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
      },
    ],
    enabled: true,
    loading: false,
    error: null,
    loadMemories: vi.fn().mockResolvedValue(undefined),
    addMemory,
    updateMemory: vi.fn(),
    deleteMemory,
    togglePin: vi.fn(),
    toggleEnabled: vi.fn(),
    setMemoryEnabled,
    clearMemories: vi.fn(),
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
    render(<MemorySettings conversationId={null} workspacePath={null} />);

    fireEvent.click(screen.getByRole("button", { name: "memory.delete" }));
    expect(deleteMemory).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "memory.delete" }),
    );

    await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith("memory-1"));
  });

  it("creates a workspace-scoped memory with an explicit lifetime", async () => {
    const { MemorySettings } = await import("../MemorySettings");
    render(<MemorySettings conversationId="conversation-1" workspacePath="/project" />);

    fireEvent.change(screen.getByLabelText("memory.scope"), { target: { value: "workspace" } });
    fireEvent.change(screen.getByLabelText("memory.expiry"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("memory.key"), { target: { value: "test command" } });
    fireEvent.change(screen.getByLabelText("memory.content"), {
      target: { value: "Use pnpm test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "memory.add" }));

    await waitFor(() =>
      expect(addMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workspace",
          scope: "/project",
          key: "test command",
          content: "Use pnpm test",
        }),
      ),
    );
    expect(typeof addMemory.mock.calls[0]?.[0].expiresAt).toBe("number");
  });

  it("lets the user disable all memory recall", async () => {
    const { MemorySettings } = await import("../MemorySettings");
    render(<MemorySettings conversationId={null} workspacePath={null} />);

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(setMemoryEnabled).toHaveBeenCalledWith(false));
  });
});
