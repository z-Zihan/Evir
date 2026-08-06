// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/storage/db", () => {
  return {
    db: {
      conversations: {
        toArray: vi.fn(() => Promise.resolve([])),
        add: vi.fn(() => Promise.resolve()),
        update: convUpdate,
        delete: vi.fn(() => Promise.resolve()),
        where: vi.fn(() => ({ equals: () => ({ toArray: () => Promise.resolve([]) }) })),
      },
      messages: {
        toArray: vi.fn(() => Promise.resolve([])),
        delete: vi.fn(() => Promise.resolve()),
      },
      attachments: {
        where: vi.fn(() => ({ equals: () => ({ delete: () => Promise.resolve() }) })),
      },
      providers: {
        toArray: vi.fn(() => Promise.resolve([])),
        update: vi.fn(() => Promise.resolve()),
      },
      usage_records: { toArray: vi.fn(() => Promise.resolve([])) },
      mcpServers: { toArray: vi.fn(() => Promise.resolve([])) },
      settings: { toArray: vi.fn(() => Promise.resolve([])) },
      transaction: (...args: unknown[]) => {
        const fn = args[args.length - 1];
        return typeof fn === "function" ? (fn as () => Promise<void>)() : Promise.resolve();
      },
    },
  };
});

import { useChatStore } from "../chat-store";

const convUpdate = vi.hoisted(() => vi.fn(() => Promise.resolve()));

beforeEach(() => {
  useChatStore.setState({
    conversations: [
      { id: "c1", title: "Chat 1", providerId: "p1", modelId: "m1", createdAt: 1, updatedAt: 1 },
      {
        id: "c2",
        title: "Chat 2",
        providerId: "p1",
        modelId: "m1",
        createdAt: 2,
        updatedAt: 2,
        pinned: 1,
      },
    ],
    currentConversationId: "c1",
    messages: [],
    streamingContent: "",
    pendingAttachments: [],
    pendingToolApproval: null,
  });
  vi.clearAllMocks();
});

describe("togglePin", () => {
  it("pins an unpinned conversation", async () => {
    await useChatStore.getState().togglePin("c1");
    expect(convUpdate).toHaveBeenCalledWith("c1", expect.objectContaining({ pinned: 1 }));
    expect(useChatStore.getState().conversations.find((c) => c.id === "c1")!.pinned).toBe(1);
  });

  it("unpins a pinned conversation", async () => {
    await useChatStore.getState().togglePin("c2");
    expect(convUpdate).toHaveBeenCalledWith("c2", expect.objectContaining({ pinned: 0 }));
    expect(useChatStore.getState().conversations.find((c) => c.id === "c2")!.pinned).toBe(0);
  });
});

describe("renameConversation", () => {
  it("updates the title in store and DB", async () => {
    await useChatStore.getState().renameConversation("c1", "New Title");
    expect(convUpdate).toHaveBeenCalledWith("c1", expect.objectContaining({ title: "New Title" }));
    expect(useChatStore.getState().conversations.find((c) => c.id === "c1")!.title).toBe(
      "New Title",
    );
  });

  it("does nothing for empty title", async () => {
    await useChatStore.getState().renameConversation("c1", "   ");
    expect(convUpdate).not.toHaveBeenCalled();
  });
});
