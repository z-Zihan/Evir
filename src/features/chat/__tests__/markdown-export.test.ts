// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const mockConvUpdate = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("../../../core/storage/db", () => ({
  db: {
    conversations: {
      get: vi.fn(() =>
        Promise.resolve({
          id: "c1",
          title: "Test Chat",
          providerId: "p1",
          modelId: "m1",
          createdAt: 1000,
          updatedAt: 2000,
        }),
      ),
      toArray: vi.fn(() => Promise.resolve([])),
      update: mockConvUpdate,
    },
    messages: {
      toArray: vi.fn(() =>
        Promise.resolve([
          {
            id: "m1",
            conversationId: "c1",
            role: "user",
            content: "Hello",
            createdAt: 1100,
            status: "complete",
          },
          {
            id: "m2",
            conversationId: "c1",
            role: "assistant",
            content: "Hi there!",
            createdAt: 1200,
            status: "complete",
          },
        ]),
      ),
      where: vi.fn(() => ({
        equals: () => ({
          sortBy: () =>
            Promise.resolve([
              {
                id: "m1",
                conversationId: "c1",
                role: "user",
                content: "Hello",
                createdAt: 1100,
                status: "complete",
              },
              {
                id: "m2",
                conversationId: "c1",
                role: "assistant",
                content: "Hi there!",
                createdAt: 1200,
                status: "complete",
              },
            ]),
        }),
      })),
    },
    attachments: {
      toArray: vi.fn(() => Promise.resolve([])),
      where: vi.fn(() => ({
        equals: () => ({ toArray: () => Promise.resolve([]) }),
      })),
    },
  },
}));

import { exportConversationAsMarkdown, exportConversationMarkdown } from "../conversation-export";
import type { ConversationRecord, MessageRecord, AttachmentRecord } from "../../../core/storage/db";

function makeConv(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "c1",
    title: "My Chat",
    providerId: "p1",
    modelId: "m1",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeMsg(
  overrides: Partial<MessageRecord> = {},
): MessageRecord & { attachments: AttachmentRecord[] } {
  return {
    id: "m1",
    conversationId: "c1",
    role: "user",
    content: "Hello world",
    createdAt: 1100,
    status: "complete",
    attachments: [],
    ...overrides,
  };
}

describe("exportConversationAsMarkdown", () => {
  it("generates markdown with title and messages", () => {
    const md = exportConversationAsMarkdown(makeConv(), [
      makeMsg({ id: "m1", role: "user", content: "Hello world" }),
      makeMsg({ id: "m2", role: "assistant", content: "Hi!" }),
    ]);

    expect(md).toContain("# My Chat");
    expect(md).toContain("## User");
    expect(md).toContain("Hello world");
    expect(md).toContain("## Assistant");
    expect(md).toContain("Hi!");
    expect(md).toContain("Provider: p1");
  });

  it("handles attachments", () => {
    const att: AttachmentRecord = {
      id: "a1",
      messageId: "m1",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      size: 100,
      data: "",
      type: "text",
      createdAt: 1100,
    };
    const md = exportConversationAsMarkdown(makeConv(), [makeMsg({ attachments: [att] })]);

    expect(md).toContain("**Attachments:**");
    expect(md).toContain("doc.pdf (application/pdf)");
  });

  it("uses Untitled for empty title", () => {
    const md = exportConversationAsMarkdown(makeConv({ title: "" }), []);
    expect(md).toContain("# Untitled");
  });
});

describe("exportConversationMarkdown", () => {
  it("returns a markdown blob", async () => {
    const blob = await exportConversationMarkdown("c1");
    expect(blob.type).toBe("text/markdown");
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(blob);
    });
    expect(text).toContain("# Test Chat");
  });
});
