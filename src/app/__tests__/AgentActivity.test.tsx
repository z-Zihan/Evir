// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentActivity } from "../AgentActivity";
import { useWorkspacePanelStore } from "../../features/workspace/workspace-panel-store";

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

vi.mock("../../features/workspace/workspace-bridge", () => ({
  useActiveWorkspaceRoot: () => "/proj",
}));

afterEach(cleanup);
beforeEach(() => {
  chatState.pendingToolApproval = null;
  useWorkspacePanelStore.setState({
    open: false,
    activeResource: null,
    activeTab: "outputs",
    history: [],
    historyIndex: -1,
  });
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

    // Summary-first groups (§40) hide per-call rows until expanded; the
    // approval panel remains the always-visible surface for the tool name.
    expect(screen.getAllByText("mcp__remote__publish")).toHaveLength(1);
    expect(screen.getByText("L4")).toBeDefined();
    expect(screen.getByText("Remote fixture · https://mcp.example.com")).toBeDefined();
    expect(screen.getByText("https://mcp.example.com")).toBeDefined();
    expect(screen.getByText("tools.approvalImpacts.remote-data-transfer")).toBeDefined();
    expect(screen.getByText("common.no")).toBeDefined();
    expect(screen.getByText('{"path":"/workspace/report.md"}')).toBeDefined();
  });
});

describe("AgentActivity tool rows (§27)", () => {
  function expandFirstGroup(container: HTMLElement) {
    fireEvent.click(container.querySelector(".tool-group-header") as HTMLElement);
  }

  it("mutation rows lead with the path + diffstat and open the diff on row click", () => {
    const { container } = render(
      <AgentActivity
        toolCalls={[
          {
            id: "t1",
            toolName: "apply_patch",
            arguments: {
              path: "src/app/Sidebar.tsx",
              old_content: "a\nb",
              new_content: "a\nb\nc\nd",
            },
          },
        ]}
        toolResults={[
          { toolCallId: "t1", toolName: "apply_patch", success: true, output: "patched" },
        ]}
        messageStatus="complete"
      />,
    );
    expandFirstGroup(container);

    // The file path is the primary field; the tool name is secondary.
    expect(screen.getByText("app/Sidebar.tsx")).toBeDefined();
    expect(screen.getByText("apply_patch")).toBeDefined();
    // Argument-derived diffstat (+4 −2) rides the row.
    expect(screen.getByText("+4")).toBeDefined();
    expect(screen.getByText("−2")).toBeDefined();

    // The whole row is the click target and opens the file's diff.
    const row = container.querySelector(".execution-step") as HTMLElement;
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);
    expect(useWorkspacePanelStore.getState().activeResource).toEqual({
      kind: "diff",
      path: "/proj/src/app/Sidebar.tsx",
    });
    expect(useWorkspacePanelStore.getState().open).toBe(true);
  });

  it("run_command rows lead with the command and show exit code + duration", () => {
    const { container } = render(
      <AgentActivity
        toolCalls={[
          { id: "t1", toolName: "run_command", arguments: { program: "pnpm", args: ["test"] } },
        ]}
        toolResults={[
          {
            toolCallId: "t1",
            toolName: "run_command",
            success: true,
            exitCode: 0,
            durationMs: 12_400,
            output: "636 passed",
          },
        ]}
        messageStatus="complete"
      />,
    );
    expandFirstGroup(container);

    expect(screen.getByText("pnpm test")).toBeDefined();
    const row = container.querySelector(".execution-step") as HTMLElement;
    expect(row.textContent).toMatch(/exit 0\s*·\s*12\.4s/);
  });

  it("a failed exit code is emphasized in danger color", () => {
    const { container } = render(
      <AgentActivity
        toolCalls={[
          { id: "t1", toolName: "run_command", arguments: { program: "pnpm", args: ["test"] } },
        ]}
        toolResults={[
          {
            toolCallId: "t1",
            toolName: "run_command",
            success: false,
            exitCode: 1,
            durationMs: 4_200,
            output: "1 failed",
          },
        ]}
        messageStatus="complete"
      />,
    );
    expandFirstGroup(container);

    const exitLabel = screen.getByText("exit 1");
    expect(exitLabel.className).toContain("text-danger");
  });

  it("plain read-only successes render quiet, not green", () => {
    const { container } = render(
      <AgentActivity
        toolCalls={[{ id: "t1", toolName: "read_file", arguments: { path: "/workspace/file.ts" } }]}
        toolResults={[
          { toolCallId: "t1", toolName: "read_file", success: true, output: "612 lines" },
        ]}
        messageStatus="complete"
      />,
    );
    expandFirstGroup(container);

    const row = container.querySelector(".execution-step") as HTMLElement;
    const icon = row.querySelector("span") as HTMLElement;
    expect(icon.className).toContain("text-muted");
    expect(icon.className).not.toContain("text-success");
  });
});
