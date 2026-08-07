// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentActivity } from "../AgentActivity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ isStreaming: false, approveTool: vi.fn(), denyTool: vi.fn() }),
}));

afterEach(cleanup);

describe("AgentActivity", () => {
  const calls = [
    { id: "tool-1", toolName: "read_file", arguments: { path: "/workspace/file.ts" } },
    { id: "tool-2", toolName: "run_command", arguments: { program: "pnpm", args: ["test"] } },
  ];

  it("shows a cancelled terminal state when a stopped message has unfinished tools", () => {
    const { container } = render(
      <AgentActivity
        toolCalls={calls}
        toolResults={[
          {
            toolCallId: "tool-1",
            toolName: "read_file",
            success: true,
            output: "done",
          },
        ]}
        messageStatus="stopped"
      />,
    );

    expect(screen.getByText("chat.stopped")).toBeDefined();
    expect(container.querySelector(".agent-activity-cancelled")).not.toBeNull();
    expect(screen.queryByText("agent.completed")).toBeNull();
  });

  it("does not mark missing tool results as complete after streaming ends", () => {
    const { container } = render(
      <AgentActivity toolCalls={calls} toolResults={[]} messageStatus="complete" />,
    );

    expect(container.querySelector(".agent-activity-cancelled")).not.toBeNull();
    expect(screen.queryByText("agent.completed")).toBeNull();
  });
});
