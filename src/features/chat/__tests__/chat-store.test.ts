import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  type AttachmentRecord,
  type ConversationRecord,
  type MessageRecord,
  type ProviderRecord,
} from "../../../core/storage/db";
import { useProviderStore } from "../../provider/provider-store";
import { useChatStore } from "../chat-store";
import { streamAssistant } from "../chat-stream";
import { useSkillStore } from "../../skills/skill-store";
import { MemoryRepository } from "../../../core/memory/memory-repository";
import { IndexedDBAdapter } from "../../../core/storage/indexed-db-adapter";
import { getStructuredStorage } from "../../../runtime/structured-storage";
import { logger } from "../../../core/logging/logger";

vi.mock("../../../i18n/config", () => ({
  default: { t: (key: string) => key },
}));
vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({
    target: "web" as const,
    capabilities: new Set(["chat", "attachments"]),
    has: () => true,
    mode: "ask" as const,
  }),
}));
vi.mock("../chat-stream", () => ({
  providerReadinessError: vi.fn(() => undefined),
  stopActiveStream: vi.fn(),
  streamAssistant: vi.fn(),
}));

const provider: ProviderRecord = {
  id: "provider-1",
  name: "Test provider",
  protocolId: "openai-chat-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "test-key",
  modelId: "test-model",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

const conversation: ConversationRecord = {
  id: "conversation-1",
  title: "Existing conversation",
  providerId: provider.id,
  modelId: provider.modelId,
  createdAt: 1,
  updatedAt: 1,
};

function message(
  id: string,
  role: MessageRecord["role"],
  content: string,
  createdAt: number,
): MessageRecord {
  return {
    id,
    conversationId: conversation.id,
    role,
    content,
    status: "complete",
    createdAt,
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.conversations.put(conversation);
  useProviderStore.setState({ providers: [provider] });
  useSkillStore.setState({ skills: [], enabledSkillIds: new Set<string>() });
  useChatStore.setState({
    conversations: [conversation],
    currentConversationId: conversation.id,
    messages: [],
    mode: "ask",
    isStreaming: false,
    activeStreamConversationId: null,
    streamingContent: "",
    error: null,
    pendingAttachments: [],
    pendingToolApproval: null,
    selectedSkillIds: new Set<string>(),
    privateSession: false,
    privateConversationId: null,
  });
  logger.clear();
  vi.mocked(streamAssistant).mockResolvedValue({
    content: "Assistant response",
    status: "complete",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("chat retries", () => {
  it("removes local-capability Skill selections when switching to Ask mode", () => {
    const instructionOnlyId = "instruction-only";
    const localToolId = "local-tool";
    useSkillStore.setState({
      skills: [
        {
          builtIn: false,
          rootPath: instructionOnlyId,
          manifest: {
            schemaVersion: 1,
            id: instructionOnlyId,
            name: "Instruction only",
            version: "1.0.0",
            description: "Instructions",
            entry: "SKILL.md",
            source: "created",
            capabilities: [],
            optionalCapabilities: [],
            optionalMcpServers: [],
            riskLevel: "low",
          },
        },
        {
          builtIn: false,
          rootPath: localToolId,
          manifest: {
            schemaVersion: 1,
            id: localToolId,
            name: "Local tool",
            version: "1.0.0",
            description: "Uses local tools",
            entry: "SKILL.md",
            source: "created",
            capabilities: ["read_file"],
            optionalCapabilities: [],
            optionalMcpServers: [],
            riskLevel: "low",
          },
        },
      ],
    });
    useChatStore.setState({
      mode: "agent",
      selectedSkillIds: new Set([instructionOnlyId, localToolId]),
    });

    useChatStore.getState().setMode("ask");

    expect([...useChatStore.getState().selectedSkillIds]).toEqual([instructionOnlyId]);
  });

  it("applies Skill selection to one message and then clears it", async () => {
    const skillId = await useSkillStore
      .getState()
      .createSkill("Prompt Helper", "Prompt helper", "UNIQUE_SELECTED_SKILL_CONTENT", "other");
    useChatStore.getState().toggleSelectedSkill(skillId);
    expect(useChatStore.getState().selectedSkillIds.has(skillId)).toBe(true);

    await useChatStore.getState().sendMessage("Use the selected workflow");

    expect(useChatStore.getState().selectedSkillIds.size).toBe(0);
    const systemPrompt = vi
      .mocked(streamAssistant)
      .mock.calls[0]?.[2].find((message) => message.role === "system")?.content;
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt).toContain("UNIQUE_SELECTED_SKILL_CONTENT");
  });

  it("does not auto-route a local-capability Skill in Ask mode", async () => {
    const skillId = await useSkillStore
      .getState()
      .createSkill(
        "Local Helper",
        "Local helper",
        "LOCAL_CAPABILITY_SKILL_CONTENT",
        "system-tools",
      );
    useSkillStore.setState((state) => ({
      skills: state.skills.map((skill) =>
        skill.manifest.id === skillId
          ? {
              ...skill,
              manifest: {
                ...skill.manifest,
                capabilities: ["read_file"],
                triggers: ["inspect local files"],
              },
            }
          : skill,
      ),
      enabledSkillIds: new Set([skillId]),
    }));

    await useChatStore.getState().sendMessage("Inspect local files");

    const providerMessages = vi.mocked(streamAssistant).mock.calls[0]?.[2] ?? [];
    expect(JSON.stringify(providerMessages)).not.toContain("LOCAL_CAPABILITY_SKILL_CONTENT");
  });

  it("rejects selected Skill content that exceeds its remaining context budget", async () => {
    useProviderStore.setState({
      providers: [
        {
          ...provider,
          modelCapabilities: { streaming: true, toolCalling: true, maxContextTokens: 100 },
        },
      ],
    });
    const skillId = await useSkillStore
      .getState()
      .createSkill("Large Helper", "Large helper", "X".repeat(2_000), "other");
    useChatStore.getState().toggleSelectedSkill(skillId);

    await useChatStore.getState().sendMessage("Use it");

    expect(useChatStore.getState().error).toBe("chat.skillContextTooLarge");
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(streamAssistant).not.toHaveBeenCalled();
  });

  it("enforces Ask mode in Web even when stale store state says Agent", async () => {
    useChatStore.setState({ mode: "agent" });

    await useChatStore.getState().sendMessage("Browser prompt");

    expect(streamAssistant).toHaveBeenCalledOnce();
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages.at(-1)?.content).toBe("Assistant response");
  });

  it("sends a new user message through the shared response stream", async () => {
    await useChatStore.getState().sendMessage("  First prompt  ");

    const messages = useChatStore.getState().messages;
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "First prompt" },
      { role: "assistant", content: "Assistant response" },
    ]);
    expect(vi.mocked(streamAssistant).mock.calls[0]?.[2]).toEqual([
      { role: "user", content: "First prompt" },
    ]);
    expect(await db.messages.count()).toBe(2);
  });

  it("notifies the composer as soon as the user message is accepted", async () => {
    let finishStream: ((value: { content: string; status: "complete" }) => void) | undefined;
    vi.mocked(streamAssistant).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStream = resolve;
        }),
    );
    const onAccepted = vi.fn();

    const pending = useChatStore.getState().sendMessage("Accepted prompt", onAccepted);
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
    expect(useChatStore.getState().messages.at(-1)?.content).toBe("Accepted prompt");
    expect(useChatStore.getState().isStreaming).toBe(true);

    finishStream?.({ content: "Assistant response", status: "complete" });
    await pending;
  });

  it("keeps a streaming response scoped to its originating conversation", async () => {
    const otherConversation: ConversationRecord = {
      ...conversation,
      id: "conversation-2",
      title: "Other conversation",
      createdAt: 2,
      updatedAt: 2,
    };
    await db.conversations.put(otherConversation);
    useChatStore.setState({ conversations: [otherConversation, conversation] });

    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    let emitDelta!: (content: string) => void;
    vi.mocked(streamAssistant).mockImplementation(async (_provider, _id, _messages, onDelta) => {
      emitDelta = onDelta;
      onDelta("A partial response");
      await streamGate;
      return { content: "A completed response", status: "complete" };
    });

    const sending = useChatStore.getState().sendMessage("Prompt in A");
    await vi.waitFor(() => expect(streamAssistant).toHaveBeenCalledOnce());
    expect(useChatStore.getState().activeStreamConversationId).toBe(conversation.id);

    await useChatStore.getState().selectConversation(otherConversation.id);
    emitDelta("A content that must not appear in B");
    expect(useChatStore.getState()).toMatchObject({
      currentConversationId: otherConversation.id,
      messages: [],
      streamingContent: "",
      error: null,
    });

    releaseStream();
    await sending;
    expect(useChatStore.getState()).toMatchObject({
      currentConversationId: otherConversation.id,
      messages: [],
      streamingContent: "",
      isStreaming: false,
      activeStreamConversationId: null,
      error: null,
    });
    expect(await db.messages.where("conversationId").equals(otherConversation.id).count()).toBe(0);
    expect(
      (await db.messages.where("conversationId").equals(conversation.id).toArray()).map(
        ({ content }) => content,
      ),
    ).toEqual(expect.arrayContaining(["Prompt in A", "A completed response"]));

    await useChatStore.getState().selectConversation(conversation.id);
    expect(useChatStore.getState().messages.map(({ content }) => content)).toEqual(
      expect.arrayContaining(["Prompt in A", "A completed response"]),
    );
    const exportedLogs = logger.exportLogs();
    expect(exportedLogs).toContain("chat.stream-started");
    expect(exportedLogs).toContain("chat.stream-completed");
    expect(exportedLogs).toContain(conversation.id);
    expect(exportedLogs).not.toContain("Prompt in A");
    expect(exportedLogs).not.toContain("A completed response");
  });

  it("does not let a stale conversation load replace a newer selection", async () => {
    const second = { ...conversation, id: "conversation-2", title: "Second", updatedAt: 2 };
    const third = { ...conversation, id: "conversation-3", title: "Third", updatedAt: 3 };
    await db.conversations.bulkPut([second, third]);
    const secondMessage = {
      ...message("second-message", "user", "Second history", 2),
      conversationId: second.id,
    };
    const thirdMessage = {
      ...message("third-message", "user", "Third history", 3),
      conversationId: third.id,
    };
    await db.messages.bulkPut([secondMessage, thirdMessage]);

    const storage = getStructuredStorage();
    const originalQuery = storage.query.bind(storage);
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    vi.spyOn(storage, "query").mockImplementation(async (entity, query) => {
      const conversationId = (query as { conversationId?: string }).conversationId;
      if (entity === "messages" && conversationId === second.id) await secondGate;
      return originalQuery(entity, query);
    });

    const selectingSecond = useChatStore.getState().selectConversation(second.id);
    await vi.waitFor(() => expect(useChatStore.getState().currentConversationId).toBe(second.id));
    await useChatStore.getState().selectConversation(third.id);
    releaseSecond();
    await selectingSecond;

    expect(useChatStore.getState().currentConversationId).toBe(third.id);
    expect(useChatStore.getState().messages.map(({ content }) => content)).toEqual([
      "Third history",
    ]);
  });

  it("loads relevant memory from storage without opening settings", async () => {
    await new MemoryRepository(new IndexedDBAdapter(db)).create({
      type: "long-term",
      scope: "global",
      key: "project language",
      content: "Always answer this project in Chinese",
    });

    await useChatStore.getState().sendMessage("Review the project language rules");

    const systemPrompt = vi
      .mocked(streamAssistant)
      .mock.calls[0]?.[2].find(({ role }) => role === "system")?.content;
    expect(systemPrompt).toContain("Always answer this project in Chinese");
  });

  it("deletes conversation-scoped memories with their conversation", async () => {
    const memory = await new MemoryRepository(new IndexedDBAdapter(db)).create({
      type: "conversation",
      scope: conversation.id,
      key: "temporary decision",
      content: "Only relevant to this conversation",
    });
    await db.settings.put({
      name: `checkpoint:${conversation.id}`,
      value: { id: "checkpoint" },
    });

    await useChatStore.getState().deleteConversation(conversation.id);

    expect(await db.memories.get(memory.id)).toBeUndefined();
    expect(await db.settings.get(`checkpoint:${conversation.id}`)).toBeUndefined();
  });

  it("removes the last assistant response before regenerating it", async () => {
    const user = message("user-1", "user", "Try this", 1);
    const assistant = message("assistant-1", "assistant", "Old response", 2);
    await db.messages.bulkPut([user, assistant]);
    useChatStore.setState({ messages: [user, assistant] });
    vi.mocked(streamAssistant).mockResolvedValue({ content: "New response", status: "complete" });

    await useChatStore.getState().regenerate();

    expect(await db.messages.get(assistant.id)).toBeUndefined();
    expect(useChatStore.getState().messages.map(({ content }) => content)).toEqual([
      "Try this",
      "New response",
    ]);
    expect(vi.mocked(streamAssistant).mock.calls[0]?.[2]).toEqual([
      { role: "user", content: "Try this" },
    ]);
  });

  it("updates a user message and deletes all later messages and attachments", async () => {
    const firstUser = message("user-1", "user", "Typo", 1);
    const firstAssistant = message("assistant-1", "assistant", "First response", 2);
    const laterUser = message("user-2", "user", "Later prompt", 3);
    const laterAssistant = message("assistant-2", "assistant", "Later response", 4);
    const attachment: AttachmentRecord = {
      id: "attachment-1",
      messageId: laterUser.id,
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      data: "notes",
      type: "text",
      createdAt: 3,
    };
    const history = [firstUser, firstAssistant, laterUser, laterAssistant];
    await db.messages.bulkPut(history);
    await db.attachments.put(attachment);
    useChatStore.setState({ messages: history });

    await useChatStore.getState().editMessage(firstUser.id, "Fixed prompt");

    const stored = await db.messages.orderBy("createdAt").toArray();
    expect(stored.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Fixed prompt" },
      { role: "assistant", content: "Assistant response" },
    ]);
    expect(await db.attachments.get(attachment.id)).toBeUndefined();
    expect(vi.mocked(streamAssistant).mock.calls[0]?.[2]).toEqual([
      { role: "user", content: "Fixed prompt" },
    ]);
  });
});

describe("private sessions", () => {
  it("keeps the conversation and messages in memory only", async () => {
    await new MemoryRepository(new IndexedDBAdapter(db)).create({
      type: "long-term",
      scope: "global",
      key: "private test",
      content: "MUST_NOT_REACH_PRIVATE_SESSION",
    });
    useChatStore.getState().togglePrivateSession();
    expect(useChatStore.getState()).toMatchObject({
      privateSession: true,
      currentConversationId: null,
      messages: [],
    });

    await useChatStore.getState().sendMessage("Private prompt");

    const state = useChatStore.getState();
    expect(state.privateConversationId).toBe(state.currentConversationId);
    expect(state.messages.map(({ content }) => content)).toEqual([
      "Private prompt",
      "Assistant response",
    ]);
    expect(await db.conversations.count()).toBe(1);
    expect(await db.messages.count()).toBe(0);
    expect(JSON.stringify(vi.mocked(streamAssistant).mock.calls[0]?.[2])).not.toContain(
      "MUST_NOT_REACH_PRIVATE_SESSION",
    );
  });

  it("discards private session state when the session closes", async () => {
    useChatStore.getState().togglePrivateSession();
    await useChatStore.getState().sendMessage("Temporary prompt");
    const privateConversationId = useChatStore.getState().privateConversationId;

    useChatStore.getState().togglePrivateSession();

    expect(useChatStore.getState()).toMatchObject({
      privateSession: false,
      privateConversationId: null,
      currentConversationId: null,
      messages: [],
    });
    expect(
      useChatStore.getState().conversations.some(({ id }) => id === privateConversationId),
    ).toBe(false);
    expect(await db.messages.count()).toBe(0);
  });
});

describe("send busy guard", () => {
  it("rejects a second send while the first is still streaming", async () => {
    let releaseStream: (value: Awaited<ReturnType<typeof streamAssistant>>) => void = () => {};
    vi.mocked(streamAssistant).mockReturnValue(
      new Promise((resolve) => {
        releaseStream = resolve;
      }),
    );
    const first = useChatStore.getState().sendMessage("first message");
    // The flag flips synchronously before any await — otherwise the second
    // send during the first one's async work started a concurrent run.
    expect(useChatStore.getState().isStreaming).toBe(true);

    await useChatStore.getState().sendMessage("second message");
    await vi.waitFor(() =>
      expect(useChatStore.getState().messages.filter(({ role }) => role === "user")).toHaveLength(
        1,
      ),
    );
    expect(useChatStore.getState().messages.map(({ content }) => content)).toEqual([
      "first message",
    ]);

    releaseStream({ content: "done", status: "complete" });
    await first;
  });
});

describe("sendMessage draft-preservation contract (K)", () => {
  it("returns false and keeps the message out of the thread when persistence fails", async () => {
    const storage = getStructuredStorage();
    const writeSpy = vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("disk full"));

    const accepted = await useChatStore.getState().sendMessage("precious draft");

    expect(accepted).toBe(false);
    expect(writeSpy).toHaveBeenCalled();
    // The user message never reached the conversation — the composer keeps
    // its draft (App layer) and the error line explains the failure.
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().error).toBe("chat.sendFailed");
    expect(useChatStore.getState().isStreaming).toBe(false);
    writeSpy.mockRestore();
  });

  it("returns true once the user message is accepted", async () => {
    const accepted = await useChatStore.getState().sendMessage("normal send");
    expect(accepted).toBe(true);
    expect(useChatStore.getState().messages.some(({ content }) => content === "normal send")).toBe(
      true,
    );
  });
});

describe("stopGeneration cancellation wiring", () => {
  it("cancels an in-progress task preparation and bumps the stream epoch", async () => {
    const orchestration = await import("../../orchestration/orchestration-session");
    const cancelSpy = vi.spyOn(orchestration, "cancelTaskPreparation");
    try {
      await useChatStore.getState().createConversation(provider.id, provider.modelId, null);
      const conversationId = useChatStore.getState().currentConversationId;
      useChatStore.setState({ isStreaming: true });
      useChatStore.getState().stopGeneration();
      expect(cancelSpy).toHaveBeenCalledWith(conversationId);
      expect(useChatStore.getState().isStreaming).toBe(false);
      expect(useChatStore.getState().streamEpoch).toBeGreaterThan(0);
    } finally {
      cancelSpy.mockRestore();
    }
  });
});

describe("compactContext manual compaction (压缩当前会话)", () => {
  it("refuses to compact while streaming, in private sessions, or with too little history", async () => {
    // Provider state is seeded directly (the mocked runtime has no storage).
    useProviderStore.setState({ providers: [provider] });
    useChatStore.setState({
      conversations: [conversation],
      currentConversationId: conversation.id,
    });
    expect(useChatStore.getState().currentConversationId).toBeTruthy();

    // Too few messages: summarization would preserve nothing — refuse early.
    await expect(useChatStore.getState().compactContext()).resolves.toBe(false);

    // Enough history but streaming → still refused.
    useChatStore.setState({
      isStreaming: true,
      messages: Array.from({ length: 8 }, (_, index) =>
        message(
          `compact-${index}`,
          index % 2 === 0 ? "user" : "assistant",
          `body ${index}`,
          Date.now() + index,
        ),
      ),
    });
    await expect(useChatStore.getState().compactContext()).resolves.toBe(false);

    // Private session → refused (the summary archive must persist).
    useChatStore.setState({ isStreaming: false, privateSession: true });
    await expect(useChatStore.getState().compactContext()).resolves.toBe(false);
  });
});
