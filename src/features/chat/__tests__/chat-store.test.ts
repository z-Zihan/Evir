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
    streamingContent: "",
    error: null,
    pendingAttachments: [],
    pendingToolApproval: null,
    selectedSkillIds: new Set<string>(),
    privateSession: false,
    privateConversationId: null,
  });
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
