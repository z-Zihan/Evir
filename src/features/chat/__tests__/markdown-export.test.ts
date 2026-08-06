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
      where: vi.fn(() => ({
        equals: () => ({
          sortBy: () =>
            Promise.resolve([
              { id: "m1", conversationId: "c1", role: "user", content: "Hello", createdAt: 1100 },
              {
                id: "m2",
                conversationId: "c1",
                role: "assistant",
                content: "Hi there!",
                createdAt: 1200,
              },
            ]),
        }),
      })),
    },
    attachments: {
      where: vi.fn(() => ({
        equals: () => ({ toArray: () => Promise.resolve([]) }),
      })),
    },
  },
}));

import { exportConversationAsMarkdown, exportConversationMarkdown } from "../conversation-export";

describe("exportConversationAsMarkdown", () => {
  it("generates markdown with title and messages", () => {
    const md = exportConversationAsMarkdown(
      {
        id: "c1",
        title: "My Chat",
        providerId: "p1",
        modelId: "m1",
        createdAt: 1000,
        updatedAt: 2000,
      },
      [
        {
          id: "m1",
          conversationId: "c1",
          role: "user",
          content: "Hello world",
          createdAt: 1100,
          attachments: [],
        },
        {
          id: "m2",
          conversationId: "c1",
          role: "assistant",
          content: "Hi!",
          createdAt: 1200,
          attachments: [],
        },
      ],
    );

    expect(md).toContain("# My Chat");
    expect(md).toContain("## User");
    expect(md).toContain("Hello world");
    expect(md).toContain("## Assistant");
    expect(md).toContain("Hi!");
    expect(md).toContain("Provider: p1");
  });

  it("handles attachments", () => {
    const md = exportConversationAsMarkdown(
      {
        id: "c1",
        title: "Test",
        providerId: "p1",
        modelId: "m1",
        createdAt: 1000,
        updatedAt: 2000,
      },
      [
        {
          id: "m1",
          conversationId: "c1",
          role: "user",
          content: "See attached",
          createdAt: 1100,
          attachments: [
            { id: "a1", messageId: "m1", fileName: "doc.pdf", mimeType: "application/pdf" },
          ],
        },
      ],
    );

    expect(md).toContain("**Attachments:**");
    expect(md).toContain("doc.pdf (application/pdf)");
  });

  it("uses Untitled for empty title", () => {
    const md = exportConversationAsMarkdown(
      { id: "c1", title: "", providerId: "p1", modelId: "m1", createdAt: 1000, updatedAt: 2000 },
      [],
    );

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
