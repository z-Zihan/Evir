// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageRecord } from "../../core/storage/db";
import { ChatMessage } from "../ChatMessage";
import { MessageList } from "../ChatView";

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
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

const copyTextWithFeedback = vi.hoisted(() =>
  vi.fn<(text: string) => Promise<boolean>>((text: string) => Promise.resolve(text.length >= 0)),
);
const notifyError = vi.hoisted(() => vi.fn());

vi.mock("../../components/feedback", () => ({
  copyTextWithFeedback,
  notify: { error: notifyError, success: vi.fn(), warning: vi.fn(), info: vi.fn() },
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatMessage actions", () => {
  it("presents consecutive assistant records as one visual reply group", () => {
    const assistantMessages = [
      { ...message("assistant", "First tool step"), id: "assistant-1" },
      { ...message("assistant", "Second tool step"), id: "assistant-2" },
      { ...message("assistant", "Final answer"), id: "assistant-3" },
    ];
    const { container } = render(
      <MessageList
        messages={[message("user", "Run the task"), ...assistantMessages]}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Evir")).toHaveLength(1);
    expect(container.querySelectorAll(".message-assistant .message-role-mark")).toHaveLength(1);
    expect(container.querySelectorAll(".message-assistant.message-grouped")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "chat.regenerate" })).toHaveLength(1);
  });

  it("uses the local nickname and does not expose conversation branching", () => {
    render(
      <ChatMessage
        message={message("user", "Local message")}
        disabled={false}
        localUserName="Zihan"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByText("Zihan")).toBeDefined();
    expect(screen.queryByRole("button", { name: "chat.branchFromHere" })).toBeNull();
  });

  it("shows which skills were applied to a sent message", () => {
    const userMessage = {
      ...message("user", "Review this change"),
      activeSkills: [{ id: "code-review", name: "Code Review" }],
    };

    render(
      <ChatMessage
        message={userMessage}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("chat.skillsUsed")).toBeDefined();
    expect(screen.getByText("Code Review")).toBeDefined();
  });

  it("edits and saves a user message", () => {
    const onEdit = vi.fn<(messageId: string, content: string) => Promise<void>>();
    onEdit.mockResolvedValue(undefined);

    render(
      <ChatMessage
        message={message("user", "Original")}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={onEdit}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(editor, { target: { value: "Corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.save" }));

    expect(onEdit).toHaveBeenCalledWith("user-1", "Corrected");
  });

  it("keeps the editor width in the bubble's coordinate system (no viewport units)", () => {
    render(
      <ChatMessage
        message={message("user", "Original")}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));

    const editorWrap = document.querySelector(".message-content > div") as HTMLElement;
    expect(editorWrap).toBeTruthy();
    expect(editorWrap.className).not.toMatch(/\d+vw/);
    expect(editorWrap.className).toContain("w-full");
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(textarea.className).toContain("max-h-");
    expect(textarea.className).toContain("overflow-y-auto");
  });

  it("saves via Cmd/Ctrl+Enter and cancels via Escape while editing", async () => {
    const onEdit = vi.fn<(messageId: string, content: string) => Promise<void>>();
    onEdit.mockResolvedValue(undefined);

    render(
      <ChatMessage
        message={message("user", "Original")}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={onEdit}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(editor, { target: { value: "Line one" } });
    // Plain Enter inserts a newline instead of submitting.
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    expect(onEdit).toHaveBeenCalledWith("user-1", "Line one");

    // Escape restores the original content and closes the editor.
    await waitFor(() => expect(screen.getByRole("button", { name: "chat.edit" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const reopened = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(reopened, { target: { value: "Discard me" } });
    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Original");
  });

  it("keeps the editor open with an error toast when the save fails", async () => {
    const onEdit = vi.fn<(messageId: string, content: string) => Promise<void>>();
    onEdit.mockRejectedValue(new Error("conversation busy"));

    render(
      <ChatMessage
        message={message("user", "Original")}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={onEdit}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(editor, { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.save" }));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith("chat.editFailed"));
    // Draft content survives the failed save.
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Keep me");
  });

  it("copies through the shared feedback helper", async () => {
    copyTextWithFeedback.mockResolvedValueOnce(true);
    render(
      <ChatMessage
        message={message("assistant", "Copy me")}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.copyMessage" }));

    await waitFor(() => expect(copyTextWithFeedback).toHaveBeenCalledWith("Copy me"));
  });

  it("regenerates an assistant message", () => {
    const onRegenerate = vi.fn<() => Promise<void>>();
    onRegenerate.mockResolvedValue(undefined);

    render(
      <ChatMessage
        message={message("assistant", "Response")}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.regenerate" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("lets the user explicitly save their message as memory", async () => {
    const userMessage = message("user", "Use pnpm for this project");
    const onRemember = vi.fn(() => Promise.resolve());

    render(
      <ChatMessage
        message={userMessage}
        disabled={false}
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onRemember={onRemember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "chat.remember" }));

    await waitFor(() => expect(onRemember).toHaveBeenCalledWith(userMessage));
    expect(screen.getByText("chat.remembered")).toBeDefined();
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
        localUserName="Local user"
        localUserAvatar=""
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    const body = document.body;
    expect(body.textContent).toContain("tools.group.inspect");
    // Tool rows live inside collapsed summary groups; open the group.
    const groupHeader = document.querySelector(".tool-group-header");
    expect(groupHeader).toBeTruthy();
    fireEvent.click(groupHeader as HTMLElement);
    expect(body.textContent).toContain("read_file");
    expect(body.textContent).toContain("notes.txt");
    expect(body.textContent).toContain("agent.completed");
  });
});
