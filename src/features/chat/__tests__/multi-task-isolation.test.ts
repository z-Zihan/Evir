// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, type ChatState } from "../chat-store";
import {
  mirrorCurrentStreamState,
  beginConversationStream,
  updateConversationStream,
  finishConversationStream,
  slotFor,
} from "../stream-ownership";
import { createActiveTaskController, stopActiveStream } from "../chat-stream";

vi.mock("../send-message", () => ({ sendChatMessage: vi.fn() }));
vi.mock("../stream-response", () => ({ streamResponse: vi.fn() }));
vi.mock("../../../runtime/use-runtime", () => ({ getRuntime: () => ({}) }));
vi.mock("../../orchestration/orchestration-session", () => ({
  cancelTaskPreparation: vi.fn(),
  prepareTask: vi.fn(),
}));

describe("multi-task stream isolation", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        {
          id: "conv-a",
          title: "A",
          providerId: "p",
          modelId: "m",
          createdAt: 1,
          updatedAt: 1,
          projectId: null,
        },
        {
          id: "conv-b",
          title: "B",
          providerId: "p",
          modelId: "m",
          createdAt: 2,
          updatedAt: 2,
          projectId: null,
        },
      ],
      currentConversationId: "conv-a",
      messages: [],
      streamSlots: {},
      streamEpochs: {},
      pendingApprovals: {},
      pendingToolApproval: null,
      isStreaming: false,
      activeStreamConversationId: null,
      activeStreamStartedAt: null,
      streamingContent: "",
    } as Partial<ChatState>);
  });

  it("keeps two concurrent stream slots with independent content", () => {
    const set = useChatStore.setState;
    const get = useChatStore.getState;
    const startedA = beginConversationStream(set, get, "conv-a");
    const startedB = beginConversationStream(set, get, "conv-b");
    updateConversationStream(set, get, "conv-a", "content-a");
    updateConversationStream(set, get, "conv-b", "content-b");

    expect(slotFor(get(), "conv-a")?.content).toBe("content-a");
    expect(slotFor(get(), "conv-b")?.content).toBe("content-b");
    // View mirror follows the conversation on screen (conv-a).
    expect(get().isStreaming).toBe(true);
    expect(get().streamingContent).toBe("content-a");
    expect(get().activeStreamConversationId).toBe("conv-a");

    // Switching to B mirrors B's live content; A keeps streaming in the slot
    // (selectConversation drives the same re-mirror).
    useChatStore.setState({ currentConversationId: "conv-b" });
    mirrorCurrentStreamState(set, get);
    updateConversationStream(set, get, "conv-a", "content-a-2");
    // B's view shows its own content, not A's latest delta.
    expect(get().streamingContent).toBe("content-b");
    expect(slotFor(get(), "conv-a")?.content).toBe("content-a-2");

    finishConversationStream(set, get, "conv-a", startedA);
    finishConversationStream(set, get, "conv-b", startedB);
    expect(slotFor(get(), "conv-a")).toBeUndefined();
    expect(slotFor(get(), "conv-b")).toBeUndefined();
    expect(get().isStreaming).toBe(false);
  });

  it("stopGeneration targets one conversation and leaves the other running", () => {
    const set = useChatStore.setState;
    const get = useChatStore.getState;
    beginConversationStream(set, get, "conv-a");
    beginConversationStream(set, get, "conv-b");
    const controllerA = createActiveTaskController("conv-a");
    const controllerB = createActiveTaskController("conv-b");

    get().stopGeneration("conv-a");

    expect(slotFor(get(), "conv-a")).toBeUndefined();
    expect(slotFor(get(), "conv-b")).toBeDefined();
    // Only conv-a's requests were aborted.
    expect(controllerA.signal.aborted).toBe(true);
    expect(controllerB.signal.aborted).toBe(false);
    // The stop epoch for A advanced (preparation cancellation detection).
    expect(get().streamEpochs["conv-a"]).toBe(1);
    expect(get().streamEpochs["conv-b"]).toBeUndefined();
    controllerA.dispose();
    controllerB.dispose();
  });

  it("abort scope: stopActiveStream(conversationId) does not abort other conversations", () => {
    const a1 = createActiveTaskController("conv-a");
    const a2 = createActiveTaskController("conv-a");
    const b1 = createActiveTaskController("conv-b");
    stopActiveStream("conv-a");
    expect(a1.signal.aborted).toBe(true);
    expect(a2.signal.aborted).toBe(true);
    expect(b1.signal.aborted).toBe(false);
    b1.dispose();
  });

  it("pending approvals are keyed per conversation", () => {
    const get = useChatStore.getState;
    const approvalA = {
      approvalId: "appr-a",
      conversationId: "conv-a",
      toolCallId: "call-a",
      toolName: "write_file",
      args: {},
      messages: [],
      providerId: "p",
      turn: { stream: { content: "", status: "complete" }, toolCalls: [], toolResults: [] },
      agentRun: { id: "run-a", snapshots: [], fileReferences: [] },
    };
    useChatStore.setState({
      pendingApprovals: { "conv-a": approvalA as never },
    } as Partial<ChatState>);
    // Viewing B must not surface A's approval.
    useChatStore.setState({ currentConversationId: "conv-b" });
    expect(get().pendingToolApproval).toBeNull();
    // Switching back to A restores it (selectConversation re-mirrors; here we
    // drive the same mirror the store uses).
    useChatStore.setState({ currentConversationId: "conv-a" });
    mirrorCurrentStreamState(useChatStore.setState, useChatStore.getState);
    expect(get().pendingToolApproval?.approvalId).toBe("appr-a");
  });
});
