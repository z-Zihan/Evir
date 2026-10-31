import { describe, expect, it } from "vitest";
import type { MessageRecord } from "../../../core/storage/db";
import {
  normalizeLatestUserMessage,
  providerMessage,
  providerWireMessages,
} from "../turn/wire-messages";

const CONVERSATION_ID = "c1";

function makeMsg(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: `m-${Math.random()}`,
    conversationId: CONVERSATION_ID,
    role: "user",
    content: "Hello",
    status: "complete",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("providerMessage", () => {
  it("returns a single plain message when there are no toolCalls", () => {
    const message = makeMsg({ role: "assistant", content: "hi there" });

    expect(providerMessage(message, "openai-chat-completions")).toEqual([
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("returns plain content for a user message with no attachments", () => {
    const message = makeMsg({ role: "user", content: "hello" });

    expect(providerMessage(message, "openai-chat-completions")).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("ignores attachments on non-user messages, keeping plain content", () => {
    const message = makeMsg({
      role: "assistant",
      content: "assistant text",
      attachments: [
        {
          id: "a1",
          messageId: "m1",
          fileName: "a.txt",
          mimeType: "text/plain",
          size: 4,
          data: "data",
          type: "text",
          createdAt: 1,
        },
      ],
    });

    expect(providerMessage(message, "openai-chat-completions")).toEqual([
      { role: "assistant", content: "assistant text" },
    ]);
  });

  describe("attachment expansion (openai-chat-completions)", () => {
    it("expands an image attachment into image_url content", () => {
      const message = makeMsg({
        role: "user",
        content: "look at this",
        attachments: [
          {
            id: "a1",
            messageId: "m1",
            fileName: "pic.png",
            mimeType: "image/png",
            size: 10,
            data: "data:image/png;base64,ABCD",
            type: "image",
            createdAt: 1,
          },
        ],
      });

      expect(providerMessage(message, "openai-chat-completions")).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image_url", image_url: { url: "data:image/png;base64,ABCD" } },
          ],
        },
      ]);
    });

    it("expands a text attachment into a fenced code block", () => {
      const message = makeMsg({
        role: "user",
        content: "see file",
        attachments: [
          {
            id: "a1",
            messageId: "m1",
            fileName: "notes.txt",
            mimeType: "text/plain",
            size: 4,
            data: "some text",
            type: "text",
            createdAt: 1,
          },
        ],
      });

      expect(providerMessage(message, "openai-chat-completions")).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "see file" },
            { type: "text", text: "```notes.txt\nsome text\n```" },
          ],
        },
      ]);
    });
  });

  describe("attachment expansion (anthropic-messages)", () => {
    it("splits an image data URL into base64 source data", () => {
      const message = makeMsg({
        role: "user",
        content: "look",
        attachments: [
          {
            id: "a1",
            messageId: "m1",
            fileName: "pic.png",
            mimeType: "image/png",
            size: 10,
            data: "data:image/png;base64,XXXX",
            type: "image",
            createdAt: 1,
          },
        ],
      });

      expect(providerMessage(message, "anthropic-messages")).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "XXXX" },
            },
          ],
        },
      ]);
    });

    it("passes through raw text data for text attachments", () => {
      const message = makeMsg({
        role: "user",
        content: "see",
        attachments: [
          {
            id: "a1",
            messageId: "m1",
            fileName: "notes.txt",
            mimeType: "text/plain",
            size: 4,
            data: "plain text body",
            type: "text",
            createdAt: 1,
          },
        ],
      });

      expect(providerMessage(message, "anthropic-messages")).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "text", text: "plain text body" },
          ],
        },
      ]);
    });
  });

  describe("attachment expansion (gemini-generate-content)", () => {
    it("expands an image attachment into inlineData", () => {
      const message = makeMsg({
        role: "user",
        content: "look",
        attachments: [
          {
            id: "a1",
            messageId: "m1",
            fileName: "pic.png",
            mimeType: "image/png",
            size: 10,
            data: "data:image/png;base64,YYYY",
            type: "image",
            createdAt: 1,
          },
        ],
      });

      expect(providerMessage(message, "gemini-generate-content")).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { inlineData: { mimeType: "image/png", data: "YYYY" } },
          ],
        },
      ]);
    });
  });

  it("expands multiple attachments in order after the leading text element", () => {
    const message = makeMsg({
      role: "user",
      content: "two files",
      attachments: [
        {
          id: "a1",
          messageId: "m1",
          fileName: "one.txt",
          mimeType: "text/plain",
          size: 3,
          data: "one",
          type: "text",
          createdAt: 1,
        },
        {
          id: "a2",
          messageId: "m1",
          fileName: "two.txt",
          mimeType: "text/plain",
          size: 3,
          data: "two",
          type: "text",
          createdAt: 2,
        },
      ],
    });

    expect(providerMessage(message, "anthropic-messages")).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "two files" },
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
    ]);
  });

  describe("with toolCalls", () => {
    it("produces an assistant tool_calls message followed by tool results", () => {
      const message = makeMsg({
        role: "assistant",
        content: "calling tools",
        toolCalls: [
          { id: "call-1", toolName: "search", arguments: { query: "cats" } },
          { id: "call-2", toolName: "fetch", arguments: { url: "https://x" } },
        ],
        toolResults: [
          { toolCallId: "call-1", toolName: "search", success: true, output: "found cats" },
          { toolCallId: "call-2", toolName: "fetch", success: false, output: "", error: "boom" },
        ],
      });

      expect(providerMessage(message, "openai-chat-completions")).toEqual([
        {
          role: "assistant",
          content: "calling tools",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "search", arguments: JSON.stringify({ query: "cats" }) },
            },
            {
              id: "call-2",
              type: "function",
              function: { name: "fetch", arguments: JSON.stringify({ url: "https://x" }) },
            },
          ],
        },
        {
          role: "tool",
          content: "found cats",
          tool_call_id: "call-1",
          name: "search",
        },
        {
          role: "tool",
          content: "",
          tool_call_id: "call-2",
          name: "fetch",
        },
      ]);
    });

    it("appends only the assistant message when toolResults is undefined", () => {
      const message = makeMsg({
        role: "assistant",
        content: "calling tool",
        toolCalls: [{ id: "call-1", toolName: "search", arguments: {} }],
      });

      const result = providerMessage(message, "openai-chat-completions");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        content: "calling tool",
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "search", arguments: "{}" } },
        ],
      });
    });
  });
});

describe("providerWireMessages", () => {
  it("filters out messages with status 'error'", () => {
    const history = [
      makeMsg({ id: "m1", role: "user", content: "ok", status: "complete" }),
      makeMsg({ id: "m2", role: "assistant", content: "broken", status: "error" }),
      makeMsg({ id: "m3", role: "user", content: "fine", status: "complete" }),
    ];

    const result = providerWireMessages(history, "openai-chat-completions");

    expect(result).toEqual([
      { role: "user", content: "ok" },
      { role: "user", content: "fine" },
    ]);
  });

  it("flattens multiple messages, preserving order, including tool call/result expansion", () => {
    const history = [
      makeMsg({ id: "m1", role: "user", content: "question" }),
      makeMsg({
        id: "m2",
        role: "assistant",
        content: "let me check",
        toolCalls: [{ id: "call-1", toolName: "search", arguments: { q: "x" } }],
        toolResults: [
          { toolCallId: "call-1", toolName: "search", success: true, output: "result" },
        ],
      }),
      makeMsg({ id: "m3", role: "assistant", content: "here's the answer" }),
    ];

    const result = providerWireMessages(history, "openai-chat-completions");

    expect(result).toEqual([
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: "let me check",
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } },
        ],
      },
      { role: "tool", content: "result", tool_call_id: "call-1", name: "search" },
      { role: "assistant", content: "here's the answer" },
    ]);
  });

  it("returns an empty array for empty history", () => {
    expect(providerWireMessages([], "openai-chat-completions")).toEqual([]);
  });
});

describe("normalizeLatestUserMessage", () => {
  it("returns the same reference when the latest user message content already matches", () => {
    const history = [
      makeMsg({ id: "m1", role: "user", content: "same" }),
      makeMsg({ id: "m2", role: "assistant", content: "reply" }),
      makeMsg({ id: "m3", role: "user", content: "same" }),
    ];

    const result = normalizeLatestUserMessage(history, "same");

    expect(result).toBe(history);
  });

  it("replaces only the latest user message content, leaving other messages untouched", () => {
    const m1 = makeMsg({ id: "m1", role: "user", content: "old" });
    const m2 = makeMsg({ id: "m2", role: "assistant", content: "reply" });
    const m3 = makeMsg({ id: "m3", role: "user", content: "old-latest" });
    const history = [m1, m2, m3];

    const result = normalizeLatestUserMessage(history, "normalized");

    expect(result).not.toBe(history);
    expect(result[0]).toBe(m1);
    expect(result[1]).toBe(m2);
    expect(result[2]).not.toBe(m3);
    expect(result[2]).toEqual({ ...m3, content: "normalized" });
  });

  it("returns the original history unchanged when there is no user message", () => {
    const history = [
      makeMsg({ id: "m1", role: "assistant", content: "a" }),
      makeMsg({ id: "m2", role: "system", content: "s" }),
    ];

    const result = normalizeLatestUserMessage(history, "normalized");

    expect(result).toBe(history);
  });

  it("returns the original (empty) history when history is empty", () => {
    const history: MessageRecord[] = [];

    const result = normalizeLatestUserMessage(history, "normalized");

    expect(result).toBe(history);
  });

  it("finds the latest user message scanning from the end, skipping later non-user messages", () => {
    const m1 = makeMsg({ id: "m1", role: "user", content: "first" });
    const m2 = makeMsg({ id: "m2", role: "user", content: "second" });
    const m3 = makeMsg({ id: "m3", role: "assistant", content: "later assistant" });
    const history = [m1, m2, m3];

    const result = normalizeLatestUserMessage(history, "normalized");

    expect(result[0]).toBe(m1);
    expect(result[1]).toEqual({ ...m2, content: "normalized" });
    expect(result[1]).not.toBe(m2);
    expect(result[2]).toBe(m3);
  });
});
