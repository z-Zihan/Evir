import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ConversationRecord, type MessageRecord } from "../../../core/storage/db";
import { getStructuredStorage } from "../../../runtime/structured-storage";
import { useOrchestrationStore } from "../../orchestration/orchestration-store";
import { useChatStore } from "../chat-store";
import type { AgentRunRecord } from "../agent-run-record";
import type { ApprovalRecord, PendingToolApproval } from "../tool-approval";
import {
  createConversation,
  createOrReuseConversation,
  deleteConversation,
  loadConversations,
  renameConversation,
  selectConversation,
  togglePin,
  updateConversationProvider,
} from "../conversation-ops";

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

const set = useChatStore.setState;
const get = useChatStore.getState;
const storage = getStructuredStorage();

function makeConversation(
  id: string,
  updatedAt: number,
  extra: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id,
    title: `Title ${id}`,
    providerId: "provider-1",
    modelId: "model-1",
    createdAt: updatedAt,
    updatedAt,
    projectId: null,
    ...extra,
  };
}

function makeMessage(
  id: string,
  conversationId: string,
  createdAt: number,
  extra: Partial<MessageRecord> = {},
): MessageRecord {
  return {
    id,
    conversationId,
    role: "user",
    content: id,
    status: "complete",
    createdAt,
    ...extra,
  };
}

function makeAgentRun(id: string, conversationId: string, updatedAt: number): AgentRunRecord {
  return {
    id,
    conversationId,
    status: "completed",
    toolCalls: [],
    toolResults: [],
    snapshots: [],
    fileReferences: [],
    verificationEvidence: [],
    resolution: { complete: true, reason: "done" },
    maxIterationsReached: false,
    createdAt: updatedAt,
    updatedAt,
  };
}

function blockedTurn(toolCallId: string): PendingToolApproval["turn"] {
  return {
    stream: { content: "working", status: "complete" },
    toolCalls: [{ id: toolCallId, toolName: "write_file", arguments: { path: "a.md" } }],
    toolResults: [
      {
        toolCallId,
        toolName: "write_file",
        success: false,
        output: "",
        error: "permission_required",
      },
    ],
  };
}

function makeApproval(
  id: string,
  conversationId: string,
  toolCallId: string,
  createdAt: number,
  extra: Partial<ApprovalRecord> = {},
): ApprovalRecord {
  return {
    id,
    runId: "run-1",
    nodeId: "legacy-agent-loop",
    conversationId,
    status: "pending",
    toolCallId,
    toolName: "write_file",
    args: { path: "a.md" },
    messages: [],
    providerId: "provider-1",
    turn: blockedTurn(toolCallId),
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
    mode: "agent",
    allowedToolIds: ["write_file"],
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  useChatStore.setState({
    conversations: [],
    currentConversationId: null,
    privateConversationId: null,
    privateSession: false,
    messages: [],
    streamingContent: "",
    error: null,
    pendingAttachments: [],
    pendingToolApproval: null,
    pendingApprovals: {},
    streamSlots: {},
    runOutcomes: {},
    conversationViewedAt: {},
    latestAgentRun: null,
  });
  useOrchestrationStore.getState().setViewedConversation(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadConversations", () => {
  it("sorts conversations by updatedAt descending", async () => {
    await db.conversations.bulkPut([
      makeConversation("a", 10),
      makeConversation("b", 30),
      makeConversation("c", 20),
    ]);

    await loadConversations(set);

    expect(get().conversations.map(({ id }) => id)).toEqual(["b", "c", "a"]);
  });

  it("seeds viewedAt with the load time only for conversations not yet seen", async () => {
    await db.conversations.bulkPut([makeConversation("seen", 10), makeConversation("new", 20)]);
    useChatStore.setState({ conversationViewedAt: { seen: 5, other: 7 } });
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    await loadConversations(set);

    expect(get().conversationViewedAt).toEqual({ seen: 5, other: 7, new: 1_000 });
  });
});

describe("createConversation", () => {
  it("persists the conversation and makes it current", async () => {
    useChatStore.setState({
      conversations: [makeConversation("old", 1)],
      messages: [makeMessage("m", "old", 1)],
      error: "boom",
    });

    const id = await createConversation(set, "provider-2", "model-2");

    const stored = await db.conversations.get(id);
    expect(stored).toMatchObject({
      id,
      title: "",
      providerId: "provider-2",
      modelId: "model-2",
      projectId: null,
    });
    const state = get();
    expect(state.conversations.map((c) => c.id)).toEqual([id, "old"]);
    expect(state.currentConversationId).toBe(id);
    expect(state.privateConversationId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.error).toBeNull();
    expect(useOrchestrationStore.getState().viewedConversationId).toBe(id);
  });

  it("does not persist private sessions and records the private conversation id", async () => {
    const id = await createConversation(set, "provider-1", "model-1", true);

    expect(await db.conversations.get(id)).toBeUndefined();
    expect(get().privateConversationId).toBe(id);
    expect(get().currentConversationId).toBe(id);
  });

  it("passes projectId through to storage and state", async () => {
    const id = await createConversation(set, "provider-1", "model-1", false, "project-9");

    expect((await db.conversations.get(id))?.projectId).toBe("project-9");
    expect(get().conversations[0]?.projectId).toBe("project-9");
  });
});

describe("createOrReuseConversation", () => {
  it("reuses the current empty conversation in the same project context", async () => {
    useChatStore.setState({
      conversations: [makeConversation("empty", 1, { projectId: "p1" })],
      currentConversationId: "empty",
      messages: [],
    });

    const id = await createOrReuseConversation(set, get, "provider-1", "model-1", "p1");

    expect(id).toBe("empty");
    expect(get().conversations).toHaveLength(1);
  });

  it("creates a new conversation when the project context differs", async () => {
    useChatStore.setState({
      conversations: [makeConversation("empty", 1, { projectId: "p1" })],
      currentConversationId: "empty",
      messages: [],
    });

    const id = await createOrReuseConversation(set, get, "provider-1", "model-1", null);

    expect(id).not.toBe("empty");
    expect(get().currentConversationId).toBe(id);
    expect(await db.conversations.get(id)).toBeDefined();
  });

  it("creates a new conversation when the current one already has messages", async () => {
    useChatStore.setState({
      conversations: [makeConversation("busy", 1)],
      currentConversationId: "busy",
      messages: [makeMessage("m", "busy", 1)],
    });

    const id = await createOrReuseConversation(set, get, "provider-1", "model-1");

    expect(id).not.toBe("busy");
  });

  it("reuses an empty private conversation without touching storage", async () => {
    const privateId = await createConversation(set, "provider-1", "model-1", true);
    useChatStore.setState({ privateSession: true });

    const id = await createOrReuseConversation(set, get, "provider-1", "model-1");

    expect(id).toBe(privateId);
    expect(await db.conversations.count()).toBe(0);
  });

  it("creates a new private conversation when private mode is on and nothing is reusable", async () => {
    useChatStore.setState({ privateSession: true });

    const id = await createOrReuseConversation(set, get, "provider-1", "model-1");

    expect(get().privateConversationId).toBe(id);
    expect(await db.conversations.count()).toBe(0);
  });
});

describe("togglePin", () => {
  it("pins an unpinned conversation and persists it", async () => {
    const conversation = makeConversation("c1", 1);
    await db.conversations.put(conversation);
    useChatStore.setState({ conversations: [conversation] });

    await togglePin(set, get, "c1");

    expect((await db.conversations.get("c1"))?.pinned).toBe(1);
    expect(get().conversations[0]?.pinned).toBe(1);
  });

  it("unpins a pinned conversation and persists it", async () => {
    const conversation = makeConversation("c1", 1, { pinned: 1 });
    await db.conversations.put(conversation);
    useChatStore.setState({ conversations: [conversation] });

    await togglePin(set, get, "c1");

    expect((await db.conversations.get("c1"))?.pinned).toBe(0);
    expect(get().conversations[0]?.pinned).toBe(0);
  });

  it("is a no-op when the conversation is neither in storage nor in memory", async () => {
    useChatStore.setState({ conversations: [] });

    await togglePin(set, get, "ghost");

    expect(get().conversations).toHaveLength(0);
    expect(get().error).toBeNull();
    expect(await db.conversations.get("ghost")).toBeUndefined();
  });

  it("sets chat.pinFailed when storage throws", async () => {
    const conversation = makeConversation("c1", 1);
    await db.conversations.put(conversation);
    useChatStore.setState({ conversations: [conversation] });
    vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("disk full"));

    await togglePin(set, get, "c1");

    expect(get().error).toBe("chat.pinFailed");
    expect(get().conversations[0]?.pinned).toBeUndefined();
  });

  it("pins a private conversation in memory without touching storage", async () => {
    const id = await createConversation(set, "provider-1", "model-1", true);
    vi.spyOn(Date, "now").mockReturnValue(700);

    await togglePin(set, get, id);

    expect(get().conversations.find((c) => c.id === id)?.pinned).toBe(1);
    expect(get().conversations.find((c) => c.id === id)?.updatedAt).toBe(700);
    expect(await db.conversations.get(id)).toBeUndefined();
    expect(get().error).toBeNull();
  });
});

describe("renameConversation", () => {
  it("trims and persists the new title", async () => {
    const conversation = makeConversation("c1", 1);
    await db.conversations.put(conversation);
    useChatStore.setState({ conversations: [conversation] });
    vi.spyOn(Date, "now").mockReturnValue(500);

    await renameConversation(set, get, "c1", "  New title  ");

    const stored = await db.conversations.get("c1");
    expect(stored?.title).toBe("New title");
    expect(stored?.updatedAt).toBe(500);
    expect(get().conversations[0]?.title).toBe("New title");
  });

  it("ignores blank titles", async () => {
    const conversation = makeConversation("c1", 1);
    await db.conversations.put(conversation);
    useChatStore.setState({ conversations: [conversation] });

    await renameConversation(set, get, "c1", "   ");

    expect((await db.conversations.get("c1"))?.title).toBe("Title c1");
    expect(get().conversations[0]?.title).toBe("Title c1");
  });

  it("is a no-op when the conversation is neither in storage nor in memory", async () => {
    useChatStore.setState({ conversations: [] });

    await renameConversation(set, get, "ghost", "Renamed");

    expect(get().conversations).toHaveLength(0);
    expect(await db.conversations.get("ghost")).toBeUndefined();
  });

  it("updates the in-memory title for a private conversation without touching storage", async () => {
    const id = await createConversation(set, "provider-1", "model-1", true);
    vi.spyOn(Date, "now").mockReturnValue(700);

    await renameConversation(set, get, id, "  Private title  ");

    expect(get().conversations.find((c) => c.id === id)?.title).toBe("Private title");
    expect(get().conversations.find((c) => c.id === id)?.updatedAt).toBe(700);
    expect(await db.conversations.get(id)).toBeUndefined();
    expect(get().error).toBeNull();
  });
});

describe("selectConversation", () => {
  it("loads sorted messages, latest agent run and marks the conversation viewed", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    await db.messages.bulkPut([
      makeMessage("m3", "c1", 30),
      makeMessage("m1", "c1", 10),
      makeMessage("m2", "c1", 20),
      makeMessage("other", "c2", 5),
    ]);
    await storage.writeMany("agent_runs", [
      makeAgentRun("run-old", "c1", 10),
      makeAgentRun("run-new", "c1", 50),
      makeAgentRun("run-other", "c2", 99),
    ]);
    useChatStore.setState({
      runOutcomes: {
        c1: { status: "completed", at: 1 },
        c2: { status: "failed", at: 1 },
      },
      conversationViewedAt: { c1: 1 },
    });
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    await selectConversation(set, get, "c1");

    const state = get();
    expect(state.currentConversationId).toBe("c1");
    expect(state.messages.map(({ id }) => id)).toEqual(["m1", "m2", "m3"]);
    expect(state.latestAgentRun?.id).toBe("run-new");
    expect(Object.keys(state.runOutcomes ?? {})).toEqual(["c2"]);
    expect(state.conversationViewedAt?.c1).toBe(2_000);
    expect(state.pendingToolApproval).toBeNull();
    expect(useOrchestrationStore.getState().viewedConversationId).toBe("c1");
  });

  it("maps pending approvals oldest-first and synthesizes the unpersisted blocked turn", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    await db.messages.put(makeMessage("u1", "c1", 10));
    await storage.writeMany("approvals", [
      makeApproval("ap-2", "c1", "call-2", 200),
      makeApproval("ap-1", "c1", "call-1", 100),
      makeApproval("ap-done", "c1", "call-3", 50, { status: "approved" }),
    ]);

    await selectConversation(set, get, "c1");

    const state = get();
    const pending = state.pendingApprovals?.c1;
    expect(pending?.approvalId).toBe("ap-1");
    expect(pending?.remainingApprovals?.map(({ approvalId }) => approvalId)).toEqual(["ap-2"]);
    expect(state.pendingToolApproval?.approvalId).toBe("ap-1");
    expect(state.messages).toHaveLength(2);
    const synthesized = state.messages[1];
    expect(synthesized?.role).toBe("assistant");
    expect(synthesized?.createdAt).toBe(11);
    expect(synthesized?.toolCalls?.[0]?.id).toBe("call-1");
  });

  it("does not synthesize the blocked turn when it is already persisted", async () => {
    const turn = blockedTurn("call-1");
    await db.conversations.put(makeConversation("c1", 1));
    await db.messages.put(
      makeMessage("a1", "c1", 10, {
        role: "assistant",
        toolCalls: turn.toolCalls ?? [],
        toolResults: turn.toolResults ?? [],
      }),
    );
    await storage.write("approvals", "ap-1", makeApproval("ap-1", "c1", "call-1", 100));

    await selectConversation(set, get, "c1");

    expect(get().messages.map(({ id }) => id)).toEqual(["a1"]);
    expect(get().pendingApprovals?.c1?.approvalId).toBe("ap-1");
  });

  it("keeps an in-memory approval over the persisted one", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    await storage.write("approvals", "ap-1", makeApproval("ap-1", "c1", "call-1", 100));
    const live = { ...makeApproval("ap-live", "c1", "call-live", 1), approvalId: "ap-live" };
    useChatStore.setState({
      pendingApprovals: {
        c1: {
          approvalId: live.approvalId,
          toolCallId: live.toolCallId,
          toolName: live.toolName,
          args: live.args,
          conversationId: "c1",
          messages: [],
          providerId: live.providerId,
          turn: live.turn,
          agentRun: live.agentRun,
        },
      },
    });

    await selectConversation(set, get, "c1");

    expect(get().pendingApprovals?.c1?.approvalId).toBe("ap-live");
    expect(get().pendingToolApproval?.approvalId).toBe("ap-live");
  });

  it("discards the loaded result when the user switched away mid-load", async () => {
    await db.conversations.bulkPut([makeConversation("c1", 1), makeConversation("c2", 2)]);
    await db.messages.put(makeMessage("m1", "c1", 10));
    await storage.write("approvals", "ap-1", makeApproval("ap-1", "c1", "call-1", 100));

    const pendingLoad = selectConversation(set, get, "c1");
    useChatStore.setState({ currentConversationId: "c2", messages: [] });
    await pendingLoad;

    const state = get();
    expect(state.currentConversationId).toBe("c2");
    expect(state.messages).toEqual([]);
    expect(state.pendingApprovals?.c1).toBeUndefined();
    expect(state.conversationViewedAt?.c1).toBeUndefined();
  });
});

describe("deleteConversation", () => {
  it("cascades deletion of the conversation's records and leaves others intact", async () => {
    await db.conversations.bulkPut([makeConversation("c1", 1), makeConversation("c2", 2)]);
    await db.messages.bulkPut([makeMessage("m1", "c1", 1), makeMessage("m2", "c2", 1)]);
    await db.attachments.bulkPut([
      {
        id: "att-1",
        messageId: "m1",
        fileName: "a.txt",
        mimeType: "text/plain",
        size: 1,
        data: "",
        type: "text",
        createdAt: 1,
      },
      {
        id: "att-2",
        messageId: "m2",
        fileName: "b.txt",
        mimeType: "text/plain",
        size: 1,
        data: "",
        type: "text",
        createdAt: 1,
      },
    ]);
    await storage.writeMany("agent_runs", [
      makeAgentRun("run-a", "c1", 1),
      makeAgentRun("run-b", "c2", 1),
    ]);
    await storage.write("settings", "checkpoint:c1", { name: "checkpoint:c1", value: "x" });
    await storage.write("settings", "checkpoint:c2", { name: "checkpoint:c2", value: "y" });
    useChatStore.setState({
      conversations: [makeConversation("c1", 1), makeConversation("c2", 2)],
      currentConversationId: "c2",
    });

    await deleteConversation(set, get, "c1");

    expect(await db.conversations.get("c1")).toBeUndefined();
    expect(await db.conversations.get("c2")).toBeDefined();
    expect((await db.messages.toArray()).map(({ id }) => id)).toEqual(["m2"]);
    expect((await db.attachments.toArray()).map(({ id }) => id)).toEqual(["att-2"]);
    expect((await storage.readAll<AgentRunRecord>("agent_runs")).map(({ id }) => id)).toEqual([
      "run-b",
    ]);
    expect(await storage.read("settings", "checkpoint:c1")).toBeUndefined();
    expect(await storage.read("settings", "checkpoint:c2")).toBeDefined();
    expect(get().conversations.map(({ id }) => id)).toEqual(["c2"]);
    expect(get().currentConversationId).toBe("c2");
  });

  it("deletes orchestration records linked through the conversation's task briefs", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    await storage.write("task_briefs", "brief-1", {
      id: "brief-1",
      runId: "orch-run",
      conversationId: "c1",
      updatedAt: 1,
    });
    await storage.write("plans", "plan-1", {
      id: "plan-1",
      runId: "orch-run",
      conversationId: "c1",
    });
    await storage.writeMany("run_steps", [
      { id: "step-1", runId: "orch-run" },
      { id: "step-2", runId: "other-run" },
    ]);
    await storage.writeMany("agent_assignments", [
      { id: "asg-1", parentRunId: "orch-run" },
      { id: "asg-2", parentRunId: "other-run" },
    ]);
    await storage.writeMany("approvals", [
      makeApproval("ap-orch", "c1", "call-1", 1, { runId: "orch-run", nodeId: "node-1" }),
      makeApproval("ap-other", "c2", "call-2", 1, { runId: "other-run", nodeId: "node-2" }),
    ]);
    await storage.write("run_events", "ev-1", { id: "ev-1", conversationId: "c1" });
    await storage.write("memories", "mem-1", { id: "mem-1", scope: "c1" });
    await storage.write("memories", "mem-2", { id: "mem-2", scope: "global" });

    await deleteConversation(set, get, "c1");

    const ids = async (entity: Parameters<typeof storage.readAll>[0]) =>
      (await storage.readAll<{ id: string }>(entity)).map(({ id }) => id);
    expect(await ids("task_briefs")).toEqual([]);
    expect(await ids("plans")).toEqual([]);
    expect(await ids("run_steps")).toEqual(["step-2"]);
    expect(await ids("agent_assignments")).toEqual(["asg-2"]);
    expect(await ids("approvals")).toEqual(["ap-other"]);
    expect(await ids("run_events")).toEqual([]);
    expect(await ids("memories")).toEqual(["mem-2"]);
  });

  it("deletes legacy agent-loop approvals by conversationId when their runId is not in any brief", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    await db.conversations.put(makeConversation("c2", 2));
    await storage.write("task_briefs", "brief-1", {
      id: "brief-1",
      runId: "orch-run",
      conversationId: "c1",
      updatedAt: 1,
    });
    await storage.writeMany("approvals", [
      makeApproval("ap-legacy-c1", "c1", "call-1", 1, { runId: "agent-run-c1" }),
      makeApproval("ap-legacy-c2", "c2", "call-2", 1, { runId: "agent-run-c2" }),
    ]);

    await deleteConversation(set, get, "c1");

    const approvalIds = (await storage.readAll<{ id: string }>("approvals")).map(({ id }) => id);
    expect(approvalIds).toEqual(["ap-legacy-c2"]);
  });

  it("clears the current view when deleting the current conversation", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    useChatStore.setState({
      conversations: [makeConversation("c1", 1)],
      currentConversationId: "c1",
      messages: [makeMessage("m1", "c1", 1)],
      latestAgentRun: makeAgentRun("run-a", "c1", 1),
    });

    await deleteConversation(set, get, "c1");

    const state = get();
    expect(state.currentConversationId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.latestAgentRun).toBeNull();
    expect(state.pendingToolApproval).toBeNull();
  });

  it("drops live stream slots and pending approvals for the deleted conversation only", async () => {
    await db.conversations.bulkPut([makeConversation("c1", 1), makeConversation("c2", 2)]);
    const approval = (conversationId: string): PendingToolApproval => ({
      approvalId: `ap-${conversationId}`,
      toolCallId: "call",
      toolName: "write_file",
      args: {},
      conversationId,
      messages: [],
      providerId: "provider-1",
      turn: blockedTurn("call"),
      agentRun: { id: "run", snapshots: [], fileReferences: [] },
    });
    useChatStore.setState({
      conversations: [makeConversation("c1", 1), makeConversation("c2", 2)],
      currentConversationId: "c2",
      streamSlots: {
        c1: { conversationId: "c1", phase: "streaming", startedAt: 1, content: "a" },
        c2: { conversationId: "c2", phase: "streaming", startedAt: 1, content: "b" },
      },
      pendingApprovals: { c1: approval("c1"), c2: approval("c2") },
    });

    await deleteConversation(set, get, "c1");

    const state = get();
    expect(Object.keys(state.streamSlots ?? {})).toEqual(["c2"]);
    expect(Object.keys(state.pendingApprovals ?? {})).toEqual(["c2"]);
    expect(state.pendingToolApproval?.approvalId).toBe("ap-c2");
  });
});

describe("updateConversationProvider", () => {
  it("updates provider and model for the current conversation", async () => {
    await db.conversations.bulkPut([makeConversation("c1", 1), makeConversation("c2", 2)]);
    useChatStore.setState({
      conversations: [makeConversation("c1", 1), makeConversation("c2", 2)],
      currentConversationId: "c1",
    });
    vi.spyOn(Date, "now").mockReturnValue(900);

    await updateConversationProvider(set, get, "provider-2", "model-2");

    expect(await db.conversations.get("c1")).toMatchObject({
      providerId: "provider-2",
      modelId: "model-2",
      updatedAt: 900,
    });
    expect((await db.conversations.get("c2"))?.providerId).toBe("provider-1");
    expect(get().conversations.find(({ id }) => id === "c1")).toMatchObject({
      providerId: "provider-2",
      modelId: "model-2",
      updatedAt: 900,
    });
    expect(get().conversations.find(({ id }) => id === "c2")?.providerId).toBe("provider-1");
  });

  it("is a no-op without a current conversation", async () => {
    await db.conversations.put(makeConversation("c1", 1));
    useChatStore.setState({ conversations: [makeConversation("c1", 1)] });

    await updateConversationProvider(set, get, "provider-2", "model-2");

    expect((await db.conversations.get("c1"))?.providerId).toBe("provider-1");
    expect(get().conversations[0]?.providerId).toBe("provider-1");
  });

  it("is a no-op when the current conversation is neither in storage nor in memory", async () => {
    useChatStore.setState({ conversations: [], currentConversationId: "ghost" });

    await updateConversationProvider(set, get, "provider-2", "model-2");

    expect(get().conversations).toHaveLength(0);
    expect(await db.conversations.get("ghost")).toBeUndefined();
  });

  it("updates the in-memory record for a private conversation without touching storage", async () => {
    const id = await createConversation(set, "provider-1", "model-1", true);
    vi.spyOn(Date, "now").mockReturnValue(900);

    await updateConversationProvider(set, get, "provider-2", "model-2");

    const conversation = get().conversations.find((c) => c.id === id);
    expect(conversation).toMatchObject({
      providerId: "provider-2",
      modelId: "model-2",
      updatedAt: 900,
    });
    expect(await db.conversations.get(id)).toBeUndefined();
  });
});
