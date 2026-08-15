// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentActivity } from "../AgentActivity";

const { chatState } = vi.hoisted(() => ({
  chatState: {
    isStreaming: false,
    approveTool: vi.fn(),
    denyTool: vi.fn(),
    pendingToolApproval: null as Record<string, unknown> | null,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

vi.mock("../../features/chat/chat-store", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector(chatState),
}));

afterEach(cleanup);
beforeEach(() => {
  chatState.pendingToolApproval = null;
});

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

  it("shows MCP destination and impact facts before approval", () => {
    chatState.pendingToolApproval = {
      toolCallId: "tool-remote",
      toolName: "mcp__remote__publish",
      args: { path: "/workspace/report.md" },
      riskLevel: "L4",
      source: "mcp-remote",
      approval: {
        target: "Remote fixture · https://mcp.example.com",
        dataDestination: "https://mcp.example.com",
        impact: "remote-data-transfer",
        reversible: false,
      },
    };

    render(
      <AgentActivity
        toolCalls={[
          {
            id: "tool-remote",
            toolName: "mcp__remote__publish",
            arguments: { path: "/workspace/report.md" },
          },
        ]}
        toolResults={[
          {
            toolCallId: "tool-remote",
            toolName: "mcp__remote__publish",
            success: false,
            output: "Permission required",
            error: "permission_required",
          },
        ]}
        messageStatus="complete"
      />,
    );

    expect(screen.getAllByText("mcp__remote__publish")).toHaveLength(2);
    expect(screen.getByText("L4")).toBeDefined();
    expect(screen.getByText("Remote fixture · https://mcp.example.com")).toBeDefined();
    expect(screen.getByText("https://mcp.example.com")).toBeDefined();
    expect(screen.getByText("tools.approvalImpacts.remote-data-transfer")).toBeDefined();
    expect(screen.getByText("common.no")).toBeDefined();
    expect(screen.getByText('{"path":"/workspace/report.md"}')).toBeDefined();
  });
});
