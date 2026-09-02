// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { SidebarConversationItem } from "../SidebarConversationItem";
import { useChatStore, type ChatState } from "../../features/chat/chat-store";
import { useConversationStatusIndex } from "../useConversationStatus";
import type { ConversationRecord } from "../../core/storage/db";

function conversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conv-1",
    title: "任务 A",
    providerId: "p",
    modelId: "m",
    createdAt: 1,
    updatedAt: 10,
    projectId: null,
    ...overrides,
  };
}

function resetChatStore(partial: Partial<ChatState>) {
  useChatStore.setState({
    conversations: [conversation()],
    currentConversationId: null,
    streamSlots: {},
    streamEpochs: {},
    pendingApprovals: {},
    runOutcomes: {},
    conversationViewedAt: { "conv-1": 5 },
    ...partial,
  } as Partial<ChatState>);
}

describe("sidebar conversation status marks", () => {
  beforeEach(() => {
    resetChatStore({});
  });

  it("renders a running label while the conversation streams", () => {
    resetChatStore({
      streamSlots: {
        "conv-1": { conversationId: "conv-1", phase: "streaming", startedAt: 1, content: "x" },
      },
    });
    render(
      <SidebarConversationItem
        conversation={conversation()}
        isActive={false}
        onSelect={() => undefined}
        onRename={() => undefined}
        onTogglePin={() => undefined}
        onDelete={() => undefined}
        status="streaming"
      />,
    );
    const mark = document.querySelector(".conversation-status-streaming");
    expect(mark).toBeTruthy();
    expect(mark?.querySelector(".conversation-status-label")).toBeTruthy();
  });

  it("renders an approval label when the task waits on the user", () => {
    render(
      <SidebarConversationItem
        conversation={conversation()}
        isActive={false}
        onSelect={() => undefined}
        onRename={() => undefined}
        onTogglePin={() => undefined}
        onDelete={() => undefined}
        status="approval"
      />,
    );
    const mark = document.querySelector(".conversation-status-approval");
    expect(mark).toBeTruthy();
    expect(mark?.querySelector(".conversation-status-label")).toBeTruthy();
  });

  it("renders only a dot (no label) for unread results", () => {
    render(
      <SidebarConversationItem
        conversation={conversation()}
        isActive={false}
        onSelect={() => undefined}
        onRename={() => undefined}
        onTogglePin={() => undefined}
        onDelete={() => undefined}
        status="unread"
      />,
    );
    const mark = document.querySelector(".conversation-status-unread");
    expect(mark).toBeTruthy();
    expect(mark?.querySelector(".conversation-status-label")).toBeNull();
  });

  it("index derives unread only after results newer than the last view", () => {
    resetChatStore({});
    const index = readIndex();
    const statusOf = (id: string, updatedAt: number) => index.statusOf(id, updatedAt);
    // updatedAt 10 > viewedAt 5 → unread; a row last updated before viewing is quiet.
    expect(statusOf("conv-1", 10)).toBe("unread");
    expect(statusOf("conv-1", 4)).toBeNull();
  });

  it("index prioritizes approval over streaming", () => {
    resetChatStore({
      streamSlots: {
        "conv-1": { conversationId: "conv-1", phase: "streaming", startedAt: 1, content: "" },
      },
      pendingApprovals: {
        "conv-1": { conversationId: "conv-1" } as never,
      },
    });
    const index = readIndex();
    expect(index.statusOf("conv-1", 10)).toBe("approval");
  });
});

function readIndex() {
  let index: ReturnType<typeof useConversationStatusIndex> | null = null;
  function Probe() {
    index = useConversationStatusIndex();
    return null;
  }
  render(<Probe />);
  return index!;
}
