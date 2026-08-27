// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRecord, ProviderRecord } from "../../../core/storage/db";
import { logger } from "../../../core/logging/logger";

vi.mock("../../provider/provider-store", () => ({
  useProviderStore: {
    getState: () => ({
      getDefaultProvider: () =>
        ({
          id: "provider-1",
          name: "Provider",
          protocolId: "openai-chat-completions",
          baseUrl: "https://example.com/v1",
          apiKey: "test-key",
          modelId: "model-1",
          enabled: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        }) satisfies ProviderRecord,
    }),
  },
}));

vi.mock("../../skills/skill-store", () => ({
  useSkillStore: {
    getState: () => ({
      skills: [],
      enabledSkillIds: new Set<string>(),
      getSkillContent: vi.fn().mockResolvedValue(""),
    }),
  },
}));

const streamAssistantMock = vi
  .fn<() => Promise<{ content: string; status: string }>>()
  .mockResolvedValue({ content: "Answer", status: "complete" });

vi.mock("../chat-stream", () => ({
  providerReadinessError: () => undefined,
  createActiveTaskController: () => ({ signal: undefined, dispose: () => undefined }),
  streamAssistant: () => streamAssistantMock(),
}));

const storageStore = new Map<string, unknown>();
const storageApply = vi.fn(
  (operations: Array<{ type: string; entity: string; id: string; data?: unknown }>) => {
    for (const op of operations) {
      const key = `${op.entity}/${op.id}`;
      if (op.type === "write") storageStore.set(key, op.data);
      else storageStore.delete(key);
    }
    return Promise.resolve();
  },
);

vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({
    read: vi.fn((entity: string, id: string) =>
      Promise.resolve(storageStore.get(`${entity}/${id}`)),
    ),
    readAll: vi.fn((entity: string) =>
      Promise.resolve(
        [...storageStore.entries()]
          .filter(([key]) => key.startsWith(`${entity}/`))
          .map(([, value]) => value),
      ),
    ),
    write: vi.fn((entity: string, id: string, data: unknown) => {
      storageStore.set(`${entity}/${id}`, data);
      return Promise.resolve();
    }),
    writeMany: vi.fn((entries: Array<{ entity: string; id: string; data: unknown }>) => {
      for (const entry of entries) storageStore.set(`${entry.entity}/${entry.id}`, entry.data);
      return Promise.resolve();
    }),
    apply: storageApply,
  }),
}));

vi.mock("../../../core/memory/memory-retrieval", () => ({
  retrieveMemoryContext: vi.fn().mockResolvedValue({ context: "", memoryIds: [] }),
}));

vi.mock("../../../core/context/checkpoint", () => ({
  createCheckpoint: vi.fn().mockResolvedValue({ id: "checkpoint-1" }),
}));

vi.mock("../../settings/personalization-settings", () => ({
  buildPersonalizationPrompt: () => "",
  loadPersonalizationPreferences: vi.fn().mockResolvedValue({}),
}));

import { streamResponse } from "../stream-response";

const messageText = "word ".repeat(600);
let conversationId = "conversation-logging";

function historyWith(
  firstMessageContent: string,
  count = 8,
  otherContent: string = messageText,
): MessageRecord[] {
  const messages: MessageRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    messages.push({
      id: `${conversationId}-message-${index}`,
      conversationId,
      role: index % 2 === 0 ? "user" : "assistant",
      content: index === 0 ? firstMessageContent : otherContent,
      status: "complete",
      createdAt: index + 1,
    });
  }
  return messages;
}

async function runStream(history: MessageRecord[]): Promise<void> {
  const state: Record<string, unknown> = {
    currentConversationId: conversationId,
    privateSession: false,
    latestAgentRun: null,
    mode: "ask",
    messages: history,
    conversations: [{ id: conversationId, title: "Conversation", updatedAt: 1 }],
    streamingContent: "",
    isStreaming: false,
    pendingToolApproval: null,
    error: undefined,
  };
  const set = (partial: unknown) => {
    const patch =
      typeof partial === "function" ? (partial as (s: unknown) => unknown)(state) : partial;
    Object.assign(state, patch as object);
  };
  const get = () => state as never;
  await streamResponse(set, get, history, conversationId, {
    target: "web",
    capabilities: new Set(["chat"]),
    has: () => true,
  } as never);
}

function eventsFor(name: string) {
  return logger
    .getEntries()
    .filter((entry) => entry.event === name && entry.conversationId === conversationId);
}

beforeEach(() => {
  conversationId = `conversation-logging-${crypto.randomUUID()}`;
  vi.clearAllMocks();
  streamAssistantMock.mockClear();
  streamAssistantMock.mockResolvedValue({ content: "Answer", status: "complete" });
});

describe("streamResponse diagnostics logging", () => {
  it("emits skill routing and memory retrieval events for a normal request", async () => {
    await runStream(historyWith(messageText));

    const routing = eventsFor("skill.routing-completed");
    expect(routing).toHaveLength(1);
    expect(routing[0]?.data).toMatchObject({
      mode: "ask",
      explicitSkillCount: 0,
      routedSkillCount: 0,
      activeSkillIds: [],
    });

    const memory = eventsFor("memory.retrieval-completed");
    expect(memory).toHaveLength(1);
    expect(memory[0]?.data).toMatchObject({
      selectedCount: 0,
      contextCharacters: 0,
    });

    // Conversation content must never be logged with these events.
    const logged = JSON.stringify(logger.getEntries());
    expect(logged).not.toContain("word word word");
    expect(eventsFor("context.budget-compacted")).toHaveLength(0);
  });

  it("emits context.budget-compacted at the tool-output stage when utilization passes 60%", async () => {
    // Default budget is 128k tokens (76.8k usable); ~50k estimated tokens lands
    // in the 60-75% band that triggers tool-output compaction only.
    const largeFirstMessage = `${messageText}\n`.repeat(60);
    const history = historyWith(largeFirstMessage);

    await runStream(history);

    const compacted = eventsFor("context.budget-compacted");
    expect(compacted).toHaveLength(1);
    expect(compacted[0]?.data).toMatchObject({
      stage: "tool-output-compaction",
      beforeMessageCount: history.length,
      afterMessageCount: history.length,
    });
    expect(
      (compacted[0]?.data?.utilizationRatio as number) > 0.6 &&
        (compacted[0]?.data?.utilizationRatio as number) <= 0.75,
    ).toBe(true);
    expect(eventsFor("context.summary-completed")).toHaveLength(0);
  });

  it("emits summary events and persists a compressed history above 75% utilization", async () => {
    // 12 messages of ~5.3k tokens each put utilization around 83% while leaving
    // at least three of the oldest messages summarizable within the keep budget.
    const largeContent = "word ".repeat(4260);
    const history = historyWith(largeContent, 12, largeContent);

    await runStream(history);

    const compacted = eventsFor("context.budget-compacted");
    expect(compacted[0]?.data).toMatchObject({ stage: "conversation-summary" });

    const started = eventsFor("context.summary-started");
    const completed = eventsFor("context.summary-completed");
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(completed.length).toBeGreaterThanOrEqual(1);
    const metrics = (completed[completed.length - 1]?.data ?? {}) as {
      beforeMessageCount?: number;
      afterMessageCount?: number;
      durationMs?: number;
    };
    expect(metrics.beforeMessageCount ?? 0).toBeGreaterThan(metrics.afterMessageCount ?? 0);
    expect(metrics.durationMs ?? -1).toBeGreaterThanOrEqual(0);

    // The summarized messages are archived and replaced by a summary message.
    const entities = storageApply.mock.calls
      .flatMap((call) => call[0] as Array<{ type: string; entity: string }>)
      .map((op) => `${op.type}:${op.entity}`);
    expect(entities).toContain("write:artifacts");
    expect(entities).toContain("write:messages");
    expect(entities).toContain("delete:messages");
  });
});
