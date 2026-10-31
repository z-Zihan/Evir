// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRecord, MessageRecord, ProviderRecord } from "../../../core/storage/db";
import type { EvirRuntime } from "../../../runtime/types";
import type { AgentLoopResult, AgentLoopTurn } from "../agent-loop";
import type { AgentRunRecord } from "../agent-run-record";
import type { PendingToolApproval } from "../chat-contracts";

type StorageOp = { type: "write" | "delete"; entity: string; id: string; data?: unknown };

const { storageState } = vi.hoisted(() => ({
  storageState: {
    entities: new Map<string, Map<string, unknown>>(),
    ops: [] as StorageOp[],
  },
}));

function entityMap(entity: string): Map<string, unknown> {
  let map = storageState.entities.get(entity);
  if (!map) {
    map = new Map();
    storageState.entities.set(entity, map);
  }
  return map;
}

vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: vi.fn(() => ({
    readAll: (entity: string) => Promise.resolve([...entityMap(entity).values()]),
    read: (entity: string, id: string) => Promise.resolve(entityMap(entity).get(id)),
    write: (entity: string, id: string, data: unknown) => {
      storageState.ops.push({ type: "write", entity, id, data });
      entityMap(entity).set(id, data);
      return Promise.resolve();
    },
    writeMany: (entity: string, records: { id: string }[]) => {
      for (const record of records) {
        storageState.ops.push({ type: "write", entity, id: record.id, data: record });
        entityMap(entity).set(record.id, record);
      }
      return Promise.resolve();
    },
    apply: (ops: StorageOp[]) => {
      for (const op of ops) {
        storageState.ops.push(op);
        if (op.type === "write") entityMap(op.entity).set(op.id, op.data);
        else entityMap(op.entity).delete(op.id);
      }
      return Promise.resolve();
    },
  })),
}));

// Same mock set that lets chat-store import cleanly under jsdom (proven by
// multi-task-isolation.test.ts) — these modules reach into IPC/network code
// at module scope that must not run in a unit test.
vi.mock("../send-message", () => ({ sendChatMessage: vi.fn() }));
vi.mock("../stream-response", () => ({ streamResponse: vi.fn() }));
vi.mock("../../../runtime/use-runtime", () => ({ getRuntime: () => ({}) }));
vi.mock("../../orchestration/orchestration-session", () => ({
  cancelTaskPreparation: vi.fn(),
  prepareTask: vi.fn(),
}));

import { useChatStore, type ChatState } from "../chat-store";
import {
  titleFor,
  persistResponse,
  persistApprovalWait,
  finalizeCompletedTurn,
  type ApprovalContext,
} from "../turn/persist-turn";
import type { TurnContext } from "../turn/turn-state";

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

const provider: ProviderRecord = {
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
};

const runtime: EvirRuntime = {
  target: "desktop",
  capabilities: new Set(),
  has: () => false,
};

function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: CONVERSATION_ID,
    title: "",
    providerId: "provider-1",
    modelId: "model-1",
    createdAt: 1,
    updatedAt: 1,
    projectId: null,
    ...overrides,
  };
}

function makeTurn(content: string): AgentLoopTurn {
  return { stream: { content, status: "complete" } };
}

function makeAgentLoopResult(turns: AgentLoopTurn[]): AgentLoopResult {
  return {
    turns,
    maxIterationsReached: false,
    messages: [],
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  };
}

function makePendingApproval(
  overrides: Partial<PendingToolApproval> & { turn: AgentLoopTurn },
): PendingToolApproval {
  return {
    toolCallId: "call-1",
    toolName: "write_file",
    args: {},
    conversationId: CONVERSATION_ID,
    messages: [],
    providerId: "provider-1",
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
    ...overrides,
  };
}

function makeApprovalContext(turn: AgentLoopTurn): ApprovalContext {
  return {
    runId: "run-1",
    nodeId: "node-1",
    mode: "agent",
    allowedToolIds: [],
    messages: [],
    turn,
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  };
}

function makeTurnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    history: [],
    conversationId: CONVERSATION_ID,
    runtime,
    provider,
    streamStartedAt: Date.now(),
    lastUserMessage: undefined,
    conversation: undefined,
    explicitlySelectedSkillIds: new Set<string>(),
    ...overrides,
  };
}

beforeEach(() => {
  storageState.entities.clear();
  storageState.ops.length = 0;
  useChatStore.setState({
    conversations: [],
    currentConversationId: CONVERSATION_ID,
    messages: [],
    streamSlots: {},
    streamEpochs: {},
    pendingApprovals: {},
    pendingToolApproval: null,
    isStreaming: false,
    activeStreamConversationId: null,
    activeStreamStartedAt: null,
    streamingContent: "",
    privateSession: false,
    latestAgentRun: null,
    error: null,
    runOutcomes: {},
  } as Partial<ChatState>);
});

describe("titleFor", () => {
  it("returns a 60-char slice of the sole user message's content when there is no title yet", () => {
    const longContent = "x".repeat(80);
    const history = [makeMsg({ role: "user", content: longContent })];

    const title = titleFor(history, false);

    expect(title).toBe(longContent.slice(0, 60));
    expect(title).toHaveLength(60);
  });

  it("returns undefined when the conversation already has a title", () => {
    const history = [makeMsg({ role: "user", content: "x".repeat(80) })];

    expect(titleFor(history, true)).toBeUndefined();
  });

  it("returns undefined when history has more than one message", () => {
    const history = [
      makeMsg({ role: "user", content: "a" }),
      makeMsg({ role: "user", content: "b" }),
    ];

    expect(titleFor(history, false)).toBeUndefined();
  });

  it("returns undefined when the sole message is not from the user", () => {
    const history = [makeMsg({ role: "assistant", content: "a" })];

    expect(titleFor(history, false)).toBeUndefined();
  });
});

describe("persistResponse", () => {
  it("returns a numeric timestamp and writes every message to storage", async () => {
    const messages = [makeMsg({ id: "m1" }), makeMsg({ id: "m2" })];

    const result = await persistResponse(messages, CONVERSATION_ID);

    expect(typeof result).toBe("number");
    const messageWrites = storageState.ops.filter(
      (op) => op.type === "write" && op.entity === "messages",
    );
    expect(messageWrites.map(({ id }) => id)).toEqual(["m1", "m2"]);
    expect(messageWrites.map(({ data }) => data)).toEqual(messages);
  });

  it("merges updatedAt and title into the conversation record when the conversation exists", async () => {
    entityMap("conversations").set(CONVERSATION_ID, makeConversation({ title: "Old" }));

    const updatedAt = await persistResponse([], CONVERSATION_ID, "New Title");

    const conversationWrites = storageState.ops.filter(
      (op) => op.type === "write" && op.entity === "conversations",
    );
    expect(conversationWrites).toHaveLength(1);
    expect(conversationWrites[0]?.data).toEqual({
      ...makeConversation({ title: "Old" }),
      updatedAt,
      title: "New Title",
    });
  });

  it("does not write a conversations record when the conversation does not exist", async () => {
    await persistResponse([makeMsg({ id: "m1" })], CONVERSATION_ID, "New Title");

    const conversationWrites = storageState.ops.filter((op) => op.entity === "conversations");
    expect(conversationWrites).toEqual([]);
  });

  it("does not overwrite the existing title when title is undefined", async () => {
    entityMap("conversations").set(CONVERSATION_ID, makeConversation({ title: "Keep Me" }));

    await persistResponse([], CONVERSATION_ID, undefined);

    const conversationWrites = storageState.ops.filter((op) => op.entity === "conversations");
    expect(conversationWrites[0]?.data).toMatchObject({ title: "Keep Me" });
  });
});

describe("persistApprovalWait", () => {
  it("appends earlier and blocked messages to store.messages with increasing createdAt when on screen", async () => {
    const earlyTurn = makeTurn("early");
    const blockedTurn = makeTurn("blocked");
    const result = makeAgentLoopResult([earlyTurn, blockedTurn]);
    const pendingApprovals = [makePendingApproval({ turn: blockedTurn })];
    const approvalContexts = [makeApprovalContext(blockedTurn)];
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("early");
    expect(messages[1]?.content).toBe("blocked");
    expect(messages[0]!.createdAt).toBeLessThan(messages[1]!.createdAt);
  });

  it("refreshes the conversation's updatedAt and keeps the list sorted", async () => {
    const earlyTurn = makeTurn("early");
    const blockedTurn = makeTurn("blocked");
    const result = makeAgentLoopResult([earlyTurn, blockedTurn]);
    const pendingApprovals = [makePendingApproval({ turn: blockedTurn })];
    const approvalContexts = [makeApprovalContext(blockedTurn)];
    const other = makeConversation({ id: "other", updatedAt: 999_999_999_999 });
    const target = makeConversation({ id: CONVERSATION_ID, updatedAt: 1 });
    useChatStore.setState({ conversations: [target, other] } as Partial<ChatState>);
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });

    const conversations = useChatStore.getState().conversations;
    const updatedTarget = conversations.find(({ id }) => id === CONVERSATION_ID);
    expect(updatedTarget?.updatedAt).toBeGreaterThan(1);
    expect(conversations).toEqual([...conversations].sort((a, b) => b.updatedAt - a.updatedAt));
  });

  it("writes nothing to storage in a private session, but still updates store.messages", async () => {
    const earlyTurn = makeTurn("early");
    const blockedTurn = makeTurn("blocked");
    const result = makeAgentLoopResult([earlyTurn, blockedTurn]);
    const pendingApprovals = [makePendingApproval({ turn: blockedTurn })];
    const approvalContexts = [makeApprovalContext(blockedTurn)];
    useChatStore.setState({ privateSession: true } as Partial<ChatState>);
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });

    expect(storageState.ops).toEqual([]);
    expect(useChatStore.getState().messages).toHaveLength(2);
  });

  it("writes one approval record per pending approval via writeMany", async () => {
    const blockedTurn1 = makeTurn("blocked-1");
    const blockedTurn2 = makeTurn("blocked-2");
    const result = makeAgentLoopResult([blockedTurn1, blockedTurn2]);
    const pendingApprovals = [
      makePendingApproval({ toolCallId: "call-1", turn: blockedTurn1 }),
      makePendingApproval({ toolCallId: "call-2", turn: blockedTurn2 }),
    ];
    const approvalContexts = [makeApprovalContext(blockedTurn1), makeApprovalContext(blockedTurn2)];
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });

    const approvalWrites = storageState.ops.filter((op) => op.entity === "approvals");
    expect(approvalWrites).toHaveLength(2);
  });

  it("stores the first pending approval with the remainder as remainingApprovals", async () => {
    const blockedTurn1 = makeTurn("blocked-1");
    const blockedTurn2 = makeTurn("blocked-2");
    const result = makeAgentLoopResult([blockedTurn1, blockedTurn2]);
    const first = makePendingApproval({ toolCallId: "call-1", turn: blockedTurn1 });
    const second = makePendingApproval({ toolCallId: "call-2", turn: blockedTurn2 });
    const pendingApprovals = [first, second];
    const approvalContexts = [makeApprovalContext(blockedTurn1), makeApprovalContext(blockedTurn2)];
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });

    const stored = useChatStore.getState().pendingApprovals[CONVERSATION_ID];
    expect(stored?.toolCallId).toBe("call-1");
    expect(stored?.remainingApprovals).toEqual([second]);
  });

  it("still records the pending approval for a conversation that is not on screen, without touching its messages", async () => {
    const earlyTurn = makeTurn("early");
    const blockedTurn = makeTurn("blocked");
    const result = makeAgentLoopResult([earlyTurn, blockedTurn]);
    const pendingApprovals = [makePendingApproval({ turn: blockedTurn })];
    const approvalContexts = [makeApprovalContext(blockedTurn)];
    useChatStore.setState({ currentConversationId: "other-conversation" } as Partial<ChatState>);
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals, approvalContexts });

    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().pendingApprovals[CONVERSATION_ID]?.toolCallId).toBe("call-1");
  });

  it("returns before writing approvals when pendingApprovals is empty", async () => {
    const earlyTurn = makeTurn("early");
    const result = makeAgentLoopResult([earlyTurn]);
    const turn = makeTurnContext();

    await persistApprovalWait(turn, { result, pendingApprovals: [], approvalContexts: [] });

    const approvalWrites = storageState.ops.filter((op) => op.entity === "approvals");
    expect(approvalWrites).toEqual([]);
  });
});

describe("finalizeCompletedTurn", () => {
  function baseArgs(overrides: Partial<Parameters<typeof finalizeCompletedTurn>[1]> = {}) {
    return {
      assistants: [makeMsg({ id: "a1", role: "assistant", content: "done" })],
      title: undefined,
      updatedAt: Date.now(),
      error: null,
      agentRunRecord: null as AgentRunRecord | null,
      lastStreamStatus: "complete" as const,
      ...overrides,
    };
  }

  it("records a 'stopped' run outcome when the last stream status is 'stopped'", () => {
    const turn = makeTurnContext();
    useChatStore.setState({ conversations: [makeConversation()] } as Partial<ChatState>);

    finalizeCompletedTurn(turn, baseArgs({ lastStreamStatus: "stopped" }));

    expect(useChatStore.getState().runOutcomes[CONVERSATION_ID]?.status).toBe("stopped");
  });

  it("records a 'failed' run outcome when error is set", () => {
    const turn = makeTurnContext();
    useChatStore.setState({ conversations: [makeConversation()] } as Partial<ChatState>);

    finalizeCompletedTurn(turn, baseArgs({ error: "boom" }));

    expect(useChatStore.getState().runOutcomes[CONVERSATION_ID]?.status).toBe("failed");
  });

  it("records a 'failed' run outcome when agentRunRecord.status is 'failed'", () => {
    const turn = makeTurnContext();
    useChatStore.setState({ conversations: [makeConversation()] } as Partial<ChatState>);
    const agentRunRecord = { status: "failed" } as AgentRunRecord;

    finalizeCompletedTurn(turn, baseArgs({ agentRunRecord }));

    expect(useChatStore.getState().runOutcomes[CONVERSATION_ID]?.status).toBe("failed");
  });

  it("records a 'completed' run outcome otherwise", () => {
    const turn = makeTurnContext();
    useChatStore.setState({ conversations: [makeConversation()] } as Partial<ChatState>);

    finalizeCompletedTurn(turn, baseArgs());

    expect(useChatStore.getState().runOutcomes[CONVERSATION_ID]?.status).toBe("completed");
  });

  it("treats a missing stream slot as ownership and lands the tail", () => {
    const streamStartedAt = Date.now();
    const turn = makeTurnContext({ streamStartedAt });
    useChatStore.setState({
      conversations: [makeConversation()],
      streamSlots: {},
    } as Partial<ChatState>);
    const agentRunRecord = { status: "completed" } as AgentRunRecord;

    finalizeCompletedTurn(turn, baseArgs({ agentRunRecord }));

    const state = useChatStore.getState();
    expect(state.messages.map(({ id }) => id)).toEqual(["a1"]);
    expect(state.streamingContent).toBe("");
    expect(state.latestAgentRun).toBe(agentRunRecord);
  });

  it("treats a non-streaming slot phase as ownership", () => {
    const streamStartedAt = Date.now();
    const turn = makeTurnContext({ streamStartedAt });
    useChatStore.setState({
      conversations: [makeConversation()],
      streamSlots: {
        [CONVERSATION_ID]: {
          conversationId: CONVERSATION_ID,
          phase: "verifying",
          startedAt: streamStartedAt,
          content: "",
        },
      },
    } as Partial<ChatState>);

    finalizeCompletedTurn(turn, baseArgs());

    expect(useChatStore.getState().messages.map(({ id }) => id)).toEqual(["a1"]);
  });

  it("is not the owner when a newer run holds the streaming slot, and skips the message/content tail", () => {
    const streamStartedAt = Date.now();
    const turn = makeTurnContext({ streamStartedAt });
    useChatStore.setState({
      conversations: [makeConversation({ title: "Old" })],
      streamSlots: {
        [CONVERSATION_ID]: {
          conversationId: CONVERSATION_ID,
          phase: "streaming",
          startedAt: streamStartedAt + 1,
          content: "newer content",
        },
      },
      streamingContent: "newer content",
      latestAgentRun: null,
    } as Partial<ChatState>);
    const agentRunRecord = { status: "completed" } as AgentRunRecord;

    finalizeCompletedTurn(turn, baseArgs({ title: "New Title", agentRunRecord, updatedAt: 42 }));

    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.streamingContent).toBe("newer content");
    expect(state.latestAgentRun).toBeNull();
    // Conversation bookkeeping and run outcome still land even without ownership.
    const conversation = state.conversations.find(({ id }) => id === CONVERSATION_ID);
    expect(conversation?.updatedAt).toBe(42);
    expect(conversation?.title).toBe("New Title");
    expect(state.runOutcomes[CONVERSATION_ID]?.status).toBe("completed");
  });

  it("owner but not the viewed conversation: skips messages, streamingContent, and latestAgentRun", () => {
    const streamStartedAt = Date.now();
    const turn = makeTurnContext({ streamStartedAt, conversationId: CONVERSATION_ID });
    useChatStore.setState({
      currentConversationId: "other-conversation",
      conversations: [makeConversation()],
      streamSlots: {},
      streamingContent: "unchanged",
      latestAgentRun: null,
    } as Partial<ChatState>);
    const agentRunRecord = { status: "completed" } as AgentRunRecord;

    finalizeCompletedTurn(turn, baseArgs({ agentRunRecord }));

    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.streamingContent).toBe("unchanged");
    expect(state.latestAgentRun).toBeNull();
  });

  it("merges title into the conversation record when provided", () => {
    const turn = makeTurnContext();
    useChatStore.setState({
      conversations: [makeConversation({ title: "Old" })],
    } as Partial<ChatState>);

    finalizeCompletedTurn(turn, baseArgs({ title: "Fresh Title" }));

    const conversation = useChatStore
      .getState()
      .conversations.find(({ id }) => id === CONVERSATION_ID);
    expect(conversation?.title).toBe("Fresh Title");
  });

  it("lands a null error onto the store when error is explicitly null", () => {
    const turn = makeTurnContext();
    useChatStore.setState({
      conversations: [makeConversation()],
      error: "stale error",
    } as Partial<ChatState>);

    finalizeCompletedTurn(turn, baseArgs({ error: null }));

    expect(useChatStore.getState().error).toBeNull();
  });
});
