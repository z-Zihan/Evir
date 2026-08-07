// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/storage/db", () => {
  return {
    db: {
      conversations: {
        toArray: vi.fn(() => Promise.resolve([])),
        add: convAdd,
        get: vi.fn((id: string) =>
          Promise.resolve(
            id === "c2"
              ? {
                  id: "c2",
                  title: "Chat 2",
                  providerId: "p1",
                  modelId: "m1",
                  createdAt: 2,
                  updatedAt: 2,
                  pinned: 1,
                }
              : {
                  id: "c1",
                  title: "Chat 1",
                  providerId: "p1",
                  modelId: "m1",
                  createdAt: 1,
                  updatedAt: 1,
                },
          ),
        ),
        put: convPut,
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

const convPut = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const convAdd = vi.hoisted(() => vi.fn(() => Promise.resolve()));

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
    expect(convPut).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", pinned: 1 }));
    expect(useChatStore.getState().conversations.find((c) => c.id === "c1")!.pinned).toBe(1);
  });

  it("unpins a pinned conversation", async () => {
    await useChatStore.getState().togglePin("c2");
    expect(convPut).toHaveBeenCalledWith(expect.objectContaining({ id: "c2", pinned: 0 }));
    expect(useChatStore.getState().conversations.find((c) => c.id === "c2")!.pinned).toBe(0);
  });
});

describe("renameConversation", () => {
  it("updates the title in store and DB", async () => {
    await useChatStore.getState().renameConversation("c1", "New Title");
    expect(convPut).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", title: "New Title" }));
    expect(useChatStore.getState().conversations.find((c) => c.id === "c1")!.title).toBe(
      "New Title",
    );
  });

  it("does nothing for empty title", async () => {
    await useChatStore.getState().renameConversation("c1", "   ");
    expect(convPut).not.toHaveBeenCalled();
  });
});

describe("createOrReuseConversation", () => {
  it("reuses the current empty conversation", async () => {
    const id = await useChatStore.getState().createOrReuseConversation("p1", "m1");
    expect(id).toBe("c1");
    expect(convAdd).not.toHaveBeenCalled();
  });
});
