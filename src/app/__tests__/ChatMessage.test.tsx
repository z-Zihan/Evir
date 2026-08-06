// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageRecord } from "../../core/storage/db";
import { ChatMessage } from "../ChatMessage";

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      isStreaming: false,
      pendingToolApproval: null,
      approveTool: vi.fn(),
      denyTool: vi.fn(),
    }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

function message(role: MessageRecord["role"], content: string): MessageRecord {
  return {
    id: `${role}-1`,
    conversationId: "conversation-1",
    role,
    content,
    status: "complete",
    createdAt: 1,
  };
}

afterEach(cleanup);

describe("ChatMessage actions", () => {
  it("edits and saves a user message", () => {
    const onEdit = vi.fn<(messageId: string, content: string) => Promise<void>>();
    onEdit.mockResolvedValue(undefined);

    render(
      <ChatMessage
        message={message("user", "Original")}
        disabled={false}
        onEdit={onEdit}
        onRegenerate={vi.fn()}
        onBranch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(editor, { target: { value: "Corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.save" }));

    expect(onEdit).toHaveBeenCalledWith("user-1", "Corrected");
  });

  it("regenerates an assistant message", () => {
    const onRegenerate = vi.fn<() => Promise<void>>();
    onRegenerate.mockResolvedValue(undefined);

    render(
      <ChatMessage
        message={message("assistant", "Response")}
        disabled={false}
        onEdit={vi.fn()}
        onRegenerate={onRegenerate}
        onBranch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.regenerate" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("renders a tool call with its arguments and result", () => {
    const assistant = message("assistant", "I read the file.");
    assistant.toolCalls = [
      {
        id: "call-1",
        toolName: "read_file",
        arguments: { path: "/tmp/notes.txt" },
      },
    ];
    assistant.toolResults = [
      {
        toolCallId: "call-1",
        toolName: "read_file",
        success: true,
        output: "Notes",
      },
    ];

    render(
      <ChatMessage
        message={assistant}
        disabled={false}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onBranch={vi.fn()}
      />,
    );

    const body = document.body;
    expect(body.textContent).toContain("read_file");
    expect(body.textContent).toContain("read_file");
    expect(body.textContent).toContain("notes.txt");
    expect(body.textContent).toContain("agent.completed");
  });
});
