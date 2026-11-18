import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand";
import type { ChatState, PendingToolApproval, StreamSlot } from "../chat-contracts";

const { loggerInfo } = vi.hoisted(() => ({ loggerInfo: vi.fn() }));

vi.mock("../../../core/logging/logger", () => ({
  logger: { info: loggerInfo },
}));

import {
  beginConversationStream,
  beginConversationVerification,
  beginPreparation,
  bumpStreamEpoch,
  endPreparation,
  finishConversationStream,
  hasActiveStream,
  mirrorCurrentStreamState,
  ownsConversationSlot,
  setPendingApproval,
  slotFor,
  streamEpochFor,
  updateConversationStream,
  visibleForConversation,
} from "../stream-ownership";

type ChatStore = StoreApi<ChatState>;

/** Only the data fields stream-ownership touches; actions are never invoked. */
function makeStore(overrides: Partial<ChatState> = {}): ChatStore {
  return createStore<ChatState>()(
    () =>
      ({
        currentConversationId: "conv-a",
        isStreaming: false,
        activeStreamConversationId: null,
        activeStreamStartedAt: null,
        streamingContent: "",
        pendingToolApproval: null,
        streamSlots: {},
        streamEpochs: {},
        pendingApprovals: {},
        ...overrides,
      }) as unknown as ChatState,
  );
}

function slot(conversationId: string, overrides: Partial<StreamSlot> = {}): StreamSlot {
  return { conversationId, phase: "streaming", startedAt: 100, content: "", ...overrides };
}

function approval(conversationId: string, toolCallId = "call-1"): PendingToolApproval {
  return {
    toolCallId,
    toolName: "write_file",
    args: { path: "a.txt" },
    conversationId,
    messages: [],
    providerId: "provider-1",
    turn: { stream: { content: "", status: "complete" } },
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  };
}

function mirror(store: ChatStore) {
  const {
    isStreaming,
    activeStreamConversationId,
    activeStreamStartedAt,
    streamingContent,
    pendingToolApproval,
  } = store.getState();
  return {
    isStreaming,
    activeStreamConversationId,
    activeStreamStartedAt,
    streamingContent,
    pendingToolApproval,
  };
}

const idleMirror = {
  isStreaming: false,
  activeStreamConversationId: null,
  activeStreamStartedAt: null,
  streamingContent: "",
  pendingToolApproval: null,
};

let now = 1_000;

beforeEach(() => {
  loggerInfo.mockClear();
  now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("slotFor", () => {
  const state = { streamSlots: { "conv-a": slot("conv-a") } };

  it("returns the slot for a known conversation", () => {
    expect(slotFor(state, "conv-a")).toBe(state.streamSlots["conv-a"]);
  });

  it("returns undefined without a conversation id", () => {
    expect(slotFor(state, null)).toBeUndefined();
    expect(slotFor(state, undefined)).toBeUndefined();
    expect(slotFor(state, "")).toBeUndefined();
  });

  it("returns undefined when the conversation has no slot", () => {
    expect(slotFor(state, "conv-b")).toBeUndefined();
  });
});

describe("hasActiveStream", () => {
  it("is false with no slots", () => {
    expect(hasActiveStream({ streamSlots: {} })).toBe(false);
  });

  it("is true when any conversation has a slot, in any phase", () => {
    expect(hasActiveStream({ streamSlots: { x: slot("x", { phase: "preparing" }) } })).toBe(true);
    expect(hasActiveStream({ streamSlots: { a: slot("a"), b: slot("b") } })).toBe(true);
  });
});

describe("mirrorCurrentStreamState", () => {
  it("mirrors a streaming slot of the current conversation", () => {
    const store = makeStore({
      streamSlots: { "conv-a": slot("conv-a", { startedAt: 42, content: "hello" }) },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toEqual({
      isStreaming: true,
      activeStreamConversationId: "conv-a",
      activeStreamStartedAt: 42,
      streamingContent: "hello",
      pendingToolApproval: null,
    });
  });

  it("marks a preparing slot as streaming but without an active stream id", () => {
    const store = makeStore({
      streamSlots: { "conv-a": slot("conv-a", { phase: "preparing", startedAt: null }) },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toEqual({ ...idleMirror, isStreaming: true });
  });

  it("does not expose an active stream id while verifying", () => {
    const store = makeStore({
      streamSlots: { "conv-a": slot("conv-a", { phase: "verifying", content: "done" }) },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toEqual({ ...idleMirror, isStreaming: true, streamingContent: "done" });
  });

  it("resets the mirror when the current conversation has no slot", () => {
    const store = makeStore({
      isStreaming: true,
      activeStreamConversationId: "conv-a",
      activeStreamStartedAt: 7,
      streamingContent: "stale",
      pendingToolApproval: approval("conv-a"),
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toEqual(idleMirror);
  });

  it("resets the mirror when no conversation is selected", () => {
    const store = makeStore({
      currentConversationId: null,
      streamSlots: { "conv-a": slot("conv-a") },
      pendingApprovals: { "conv-a": approval("conv-a") },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toEqual(idleMirror);
  });

  it("mirrors the current conversation's pending approval", () => {
    const pending = approval("conv-a");
    const store = makeStore({ pendingApprovals: { "conv-a": pending } });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(store.getState().pendingToolApproval).toBe(pending);
    expect(store.getState().isStreaming).toBe(false);
  });

  it("ignores another conversation's slot and approval", () => {
    const store = makeStore({
      streamSlots: { "conv-b": slot("conv-b", { content: "background" }) },
      pendingApprovals: { "conv-b": approval("conv-b") },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toEqual(idleMirror);
  });

  it("follows currentConversationId when several conversations have slots", () => {
    const store = makeStore({
      currentConversationId: "conv-b",
      streamSlots: {
        "conv-a": slot("conv-a", { startedAt: 1, content: "a" }),
        "conv-b": slot("conv-b", { startedAt: 2, content: "b" }),
      },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(mirror(store)).toMatchObject({
      activeStreamConversationId: "conv-b",
      activeStreamStartedAt: 2,
      streamingContent: "b",
    });
  });
});

describe("streamEpochFor", () => {
  it("returns 0 when the conversation has no recorded epoch", () => {
    expect(streamEpochFor({ streamEpochs: {} }, "conv-a")).toBe(0);
  });

  it("returns the recorded epoch", () => {
    expect(streamEpochFor({ streamEpochs: { "conv-a": 3 } }, "conv-a")).toBe(3);
  });
});

describe("bumpStreamEpoch", () => {
  it("increments from 0 and then from the stored value, per conversation", () => {
    const store = makeStore({ streamEpochs: { "conv-b": 5 } });
    bumpStreamEpoch(store.setState, "conv-a");
    expect(store.getState().streamEpochs).toEqual({ "conv-a": 1, "conv-b": 5 });
    bumpStreamEpoch(store.setState, "conv-a");
    bumpStreamEpoch(store.setState, "conv-b");
    expect(store.getState().streamEpochs).toEqual({ "conv-a": 2, "conv-b": 6 });
  });
});

describe("beginPreparation / endPreparation", () => {
  it("writes a preparing slot, mirrors it, and returns the captured epoch", () => {
    const store = makeStore({
      streamEpochs: { "conv-a": 4 },
      streamSlots: { "conv-b": slot("conv-b") },
    });
    const epoch = beginPreparation(store.setState, store.getState, "conv-a");
    expect(epoch).toBe(4);
    expect(store.getState().streamSlots).toEqual({
      "conv-a": { conversationId: "conv-a", phase: "preparing", startedAt: null, content: "" },
      "conv-b": slot("conv-b"),
    });
    expect(mirror(store)).toEqual({ ...idleMirror, isStreaming: true });
  });

  it("returns 0 when no epoch is recorded", () => {
    const store = makeStore();
    expect(beginPreparation(store.setState, store.getState, "conv-a")).toBe(0);
  });

  it("removes a preparing slot when the epoch still matches", () => {
    const store = makeStore({ streamSlots: { "conv-b": slot("conv-b") } });
    const epoch = beginPreparation(store.setState, store.getState, "conv-a");
    endPreparation(store.setState, store.getState, "conv-a", epoch);
    expect(store.getState().streamSlots).toEqual({ "conv-b": slot("conv-b") });
    expect(mirror(store)).toEqual(idleMirror);
  });

  it("leaves a slot that has moved on to streaming untouched", () => {
    const store = makeStore();
    const epoch = beginPreparation(store.setState, store.getState, "conv-a");
    const startedAt = beginConversationStream(store.setState, store.getState, "conv-a");
    endPreparation(store.setState, store.getState, "conv-a", epoch);
    expect(slotFor(store.getState(), "conv-a")).toMatchObject({ phase: "streaming", startedAt });
    expect(store.getState().activeStreamConversationId).toBe("conv-a");
  });

  it("leaves the slot untouched when the epoch was bumped", () => {
    const store = makeStore();
    const epoch = beginPreparation(store.setState, store.getState, "conv-a");
    bumpStreamEpoch(store.setState, "conv-a");
    endPreparation(store.setState, store.getState, "conv-a", epoch);
    expect(slotFor(store.getState(), "conv-a")?.phase).toBe("preparing");
  });

  it("is a no-op when there is no slot", () => {
    const store = makeStore();
    const before = store.getState();
    endPreparation(store.setState, store.getState, "conv-a", 0);
    expect(store.getState()).toBe(before);
  });
});

describe("beginConversationStream", () => {
  it("opens a streaming slot stamped with Date.now and mirrors it", () => {
    const store = makeStore();
    now = 5_000;
    const startedAt = beginConversationStream(store.setState, store.getState, "conv-a");
    expect(startedAt).toBe(5_000);
    expect(slotFor(store.getState(), "conv-a")).toEqual({
      conversationId: "conv-a",
      phase: "streaming",
      startedAt: 5_000,
      content: "",
    });
    expect(mirror(store)).toEqual({
      ...idleMirror,
      isStreaming: true,
      activeStreamConversationId: "conv-a",
      activeStreamStartedAt: 5_000,
    });
    expect(loggerInfo).toHaveBeenCalledWith("stream", "chat.stream-started", {
      conversationId: "conv-a",
    });
  });

  it("does not move the mirror when a background conversation starts", () => {
    const store = makeStore();
    beginConversationStream(store.setState, store.getState, "conv-b");
    expect(slotFor(store.getState(), "conv-b")?.phase).toBe("streaming");
    expect(mirror(store)).toEqual(idleMirror);
  });
});

describe("updateConversationStream", () => {
  it("updates the slot and the mirror for the current conversation", () => {
    const store = makeStore({ streamSlots: { "conv-a": slot("conv-a") } });
    updateConversationStream(store.setState, store.getState, "conv-a", "partial");
    expect(slotFor(store.getState(), "conv-a")?.content).toBe("partial");
    expect(store.getState().streamingContent).toBe("partial");
  });

  it("updates only the slot for a background conversation", () => {
    const store = makeStore({
      streamingContent: "foreground",
      streamSlots: { "conv-b": slot("conv-b") },
    });
    updateConversationStream(store.setState, store.getState, "conv-b", "background");
    expect(slotFor(store.getState(), "conv-b")?.content).toBe("background");
    expect(store.getState().streamingContent).toBe("foreground");
  });

  it("restores background content into the mirror after switching to it", () => {
    const store = makeStore({ streamSlots: { "conv-b": slot("conv-b") } });
    updateConversationStream(store.setState, store.getState, "conv-b", "kept");
    store.setState({ currentConversationId: "conv-b" });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(store.getState().streamingContent).toBe("kept");
  });

  it("is a no-op when the conversation has no slot", () => {
    const store = makeStore();
    const before = store.getState();
    updateConversationStream(store.setState, store.getState, "conv-a", "ignored");
    expect(store.getState()).toBe(before);
  });
});

describe("beginConversationVerification", () => {
  it("moves a matching streaming slot to verifying and keeps its content", () => {
    const store = makeStore({
      streamSlots: { "conv-a": slot("conv-a", { startedAt: 100, content: "answer" }) },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    beginConversationVerification(store.setState, store.getState, "conv-a", 100);
    expect(slotFor(store.getState(), "conv-a")).toEqual(
      slot("conv-a", { phase: "verifying", startedAt: 100, content: "answer" }),
    );
    expect(mirror(store)).toEqual({ ...idleMirror, isStreaming: true, streamingContent: "answer" });
  });

  it.each([
    ["there is no slot", {}],
    [
      "the slot is preparing",
      { "conv-a": slot("conv-a", { phase: "preparing", startedAt: null }) },
    ],
    ["the slot is already verifying", { "conv-a": slot("conv-a", { phase: "verifying" }) }],
    ["startedAt belongs to another run", { "conv-a": slot("conv-a", { startedAt: 200 }) }],
  ] satisfies [string, Record<string, StreamSlot>][])(
    "leaves state unchanged when %s",
    (_label, streamSlots) => {
      const store = makeStore({ streamSlots });
      const before = store.getState();
      beginConversationVerification(store.setState, store.getState, "conv-a", 100);
      expect(store.getState()).toBe(before);
    },
  );
});

describe("finishConversationStream", () => {
  it.each(["streaming", "verifying"] as const)(
    "removes a %s slot whose startedAt matches and clears the mirror",
    (phase) => {
      const store = makeStore({
        streamSlots: {
          "conv-a": slot("conv-a", { phase, startedAt: 100, content: "x" }),
          "conv-b": slot("conv-b"),
        },
      });
      mirrorCurrentStreamState(store.setState, store.getState);
      finishConversationStream(store.setState, store.getState, "conv-a", 100);
      expect(store.getState().streamSlots).toEqual({ "conv-b": slot("conv-b") });
      expect(mirror(store)).toEqual(idleMirror);
    },
  );

  it("does not delete a newer run's slot when a stale tail finishes", () => {
    const store = makeStore();
    now = 1_000;
    const oldRun = beginConversationStream(store.setState, store.getState, "conv-a");
    // The old run is stopped; a newer run starts before its persistence tail drains.
    now = 2_000;
    const newRun = beginConversationStream(store.setState, store.getState, "conv-a");
    updateConversationStream(store.setState, store.getState, "conv-a", "new content");

    finishConversationStream(store.setState, store.getState, "conv-a", oldRun);

    expect(slotFor(store.getState(), "conv-a")).toEqual({
      conversationId: "conv-a",
      phase: "streaming",
      startedAt: newRun,
      content: "new content",
    });
    expect(mirror(store)).toMatchObject({
      isStreaming: true,
      activeStreamConversationId: "conv-a",
      activeStreamStartedAt: newRun,
      streamingContent: "new content",
    });

    finishConversationStream(store.setState, store.getState, "conv-a", newRun);
    expect(slotFor(store.getState(), "conv-a")).toBeUndefined();
  });

  it("does not delete a preparing slot even if startedAt were to match", () => {
    const store = makeStore({
      streamSlots: { "conv-a": slot("conv-a", { phase: "preparing", startedAt: 100 }) },
    });
    finishConversationStream(store.setState, store.getState, "conv-a", 100);
    expect(slotFor(store.getState(), "conv-a")?.phase).toBe("preparing");
  });

  it("is a no-op on state when there is no slot, but still logs completion", () => {
    const store = makeStore();
    const before = store.getState();
    now = 1_500;
    finishConversationStream(store.setState, store.getState, "conv-a", 1_000);
    expect(store.getState()).toBe(before);
    expect(loggerInfo).toHaveBeenCalledWith("stream", "chat.stream-completed", {
      conversationId: "conv-a",
      durationMs: 500,
    });
  });
});

describe("ownsConversationSlot", () => {
  it("returns true when there is no slot", () => {
    const store = makeStore();
    expect(ownsConversationSlot(store.getState, "conv-a", 100)).toBe(true);
  });

  it.each(["preparing", "verifying"] as const)("returns true when the slot is %s", (phase) => {
    const store = makeStore({ streamSlots: { "conv-a": slot("conv-a", { phase, startedAt: 9 }) } });
    expect(ownsConversationSlot(store.getState, "conv-a", 100)).toBe(true);
  });

  it("returns true for the streaming run with the matching startedAt", () => {
    const store = makeStore({ streamSlots: { "conv-a": slot("conv-a", { startedAt: 100 }) } });
    expect(ownsConversationSlot(store.getState, "conv-a", 100)).toBe(true);
  });

  it("returns false when a newer streaming run owns the conversation", () => {
    const store = makeStore({ streamSlots: { "conv-a": slot("conv-a", { startedAt: 200 }) } });
    expect(ownsConversationSlot(store.getState, "conv-a", 100)).toBe(false);
  });
});

describe("setPendingApproval", () => {
  it("sets and mirrors an approval for the current conversation", () => {
    const store = makeStore();
    const pending = approval("conv-a");
    setPendingApproval(store.setState, store.getState, "conv-a", pending);
    expect(store.getState().pendingApprovals).toEqual({ "conv-a": pending });
    expect(store.getState().pendingToolApproval).toBe(pending);
  });

  it("records a background approval without mirroring it", () => {
    const store = makeStore();
    const pending = approval("conv-b");
    setPendingApproval(store.setState, store.getState, "conv-b", pending);
    expect(store.getState().pendingApprovals).toEqual({ "conv-b": pending });
    expect(store.getState().pendingToolApproval).toBeNull();
  });

  it("clears only the given conversation's approval and its mirror", () => {
    const other = approval("conv-b");
    const store = makeStore({
      pendingApprovals: { "conv-a": approval("conv-a"), "conv-b": other },
    });
    mirrorCurrentStreamState(store.setState, store.getState);
    expect(store.getState().pendingToolApproval).not.toBeNull();

    setPendingApproval(store.setState, store.getState, "conv-a", null);
    expect(store.getState().pendingApprovals).toEqual({ "conv-b": other });
    expect(store.getState().pendingToolApproval).toBeNull();
  });

  it("replaces an existing approval for the same conversation", () => {
    const store = makeStore({ pendingApprovals: { "conv-a": approval("conv-a", "old") } });
    const next = approval("conv-a", "new");
    setPendingApproval(store.setState, store.getState, "conv-a", next);
    expect(store.getState().pendingApprovals["conv-a"]).toBe(next);
    expect(store.getState().pendingToolApproval).toBe(next);
  });
});

describe("visibleForConversation", () => {
  it("is true only for the current conversation", () => {
    const store = makeStore();
    expect(visibleForConversation(store.getState, "conv-a")).toBe(true);
    expect(visibleForConversation(store.getState, "conv-b")).toBe(false);
  });

  it("is false when no conversation is selected", () => {
    const store = makeStore({ currentConversationId: null });
    expect(visibleForConversation(store.getState, "conv-a")).toBe(false);
  });
});
