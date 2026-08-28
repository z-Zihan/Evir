// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const continueAgentLoop = vi.fn<(options: unknown) => Promise<unknown>>();
const executeApproved = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const buildDenial = vi.fn<(...args: unknown[]) => { resolvedTurn: unknown; messages: unknown[] }>();
const persistTurn = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getApprovalContext = vi.fn<(...args: unknown[]) => unknown>();
const finalizeApprovalFlow = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const cancelCurrentRun = vi.fn<(...args: unknown[]) => Promise<undefined>>();
const resolveCurrentApprovalNode = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const storageRead = vi.fn<(...args: unknown[]) => Promise<undefined>>();
const storageWrite =
  vi.fn<(entity?: string, id?: string, data?: { status?: string }) => Promise<undefined>>();

vi.mock("../agent-loop", () => ({
  continueAgentLoop: (...args: Parameters<typeof continueAgentLoop>) => continueAgentLoop(...args),
}));
vi.mock("../chat-stream", () => ({
  createActiveTaskController: () => ({
    signal: new AbortController().signal,
    dispose: () => undefined,
  }),
}));
vi.mock("../tool-approval-helpers", () => ({
  getApprovalContext: (...args: Parameters<typeof getApprovalContext>) =>
    getApprovalContext(...args),
  executeApproved: (...args: Parameters<typeof executeApproved>) => executeApproved(...args),
  buildDenial: (...args: Parameters<typeof buildDenial>) => buildDenial(...args),
  persistTurn: (...args: Parameters<typeof persistTurn>) => persistTurn(...args),
  finalizeApprovalFlow: (...args: Parameters<typeof finalizeApprovalFlow>) =>
    finalizeApprovalFlow(...args),
}));
vi.mock("../../orchestration/orchestration-session", () => ({
  cancelCurrentRun: (...args: Parameters<typeof cancelCurrentRun>) => cancelCurrentRun(...args),
  resolveCurrentApprovalNode: (...args: Parameters<typeof resolveCurrentApprovalNode>) =>
    resolveCurrentApprovalNode(...args),
}));
vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({
    read: (...args: Parameters<typeof storageRead>) => storageRead(...args),
    write: (...args: Parameters<typeof storageWrite>) => storageWrite(...args),
  }),
}));
vi.mock("../../orchestration/orchestration-store", () => ({
  useOrchestrationStore: { getState: () => ({ current: null, setCurrent: vi.fn() }) },
}));
vi.mock("../../../i18n/config", () => ({
  default: { t: (key: string) => key },
}));

import { approveTool, denyTool, type PendingToolApproval } from "../tool-approval";
import type { ChatState } from "../chat-store";
import type { StoreApi } from "zustand";
import type { EvirRuntime } from "../../../runtime/types";

function pendingApproval(overrides: Partial<PendingToolApproval> = {}): PendingToolApproval {
  return {
    approvalId: "approval-1",
    conversationId: "conversation-1",
    toolCallId: "call-1",
    toolName: "run_command",
    providerId: "provider-1",
    args: { program: "pnpm", args: ["check"] },
    mode: "agent",
    messages: [{ role: "user", content: "do it" }],
    turn: {
      stream: { content: "working", status: "complete" },
      toolCalls: [],
      toolResults: [],
    },
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
    remainingApprovals: [],
    ...overrides,
  };
}

function harness(pending: PendingToolApproval, runtimeOverrides: Partial<EvirRuntime> = {}) {
  const runtime: EvirRuntime = {
    target: "desktop",
    capabilities: new Set(["terminal"]),
    has: () => true,
    toolExecutor: { execute: vi.fn() },
    permissionContext: { profile: "workspace", roots: ["/project"] },
    ...runtimeOverrides,
  } as EvirRuntime;
  getApprovalContext.mockReturnValue({
    provider: {
      id: "provider-1",
      name: "P",
      protocolId: "openai-chat-completions",
      apiKey: "k",
      modelId: "m",
    },
    runtime,
    streamStartedAt: 111,
  });
  const state: Record<string, unknown> = {
    currentConversationId: "conversation-1",
    privateSession: false,
    isStreaming: true,
    activeStreamConversationId: "conversation-1",
    activeStreamStartedAt: 111,
    streamingContent: "",
    pendingToolApproval: null,
    error: null,
  };
  // zustand setState accepts a partial object OR an updater function.
  const set = (
    patch: Record<string, unknown> | ((state: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    if (typeof patch === "function") Object.assign(state, patch(state));
    else Object.assign(state, patch);
  };
  const get = () => state;
  return {
    set: set as unknown as StoreApi<ChatState>["setState"],
    get: get as unknown as StoreApi<ChatState>["getState"],
    state,
    runtime,
  };
}

const resolvedTurn = {
  stream: { content: "approved run", status: "complete" },
  toolCalls: [],
  toolResults: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  storageRead.mockResolvedValue(undefined);
  storageWrite.mockResolvedValue(undefined);
  resolveCurrentApprovalNode.mockResolvedValue(false);
  continueAgentLoop.mockResolvedValue({
    turns: [resolvedTurn],
    maxIterationsReached: false,
    messages: [{ role: "assistant", content: "approved run" }],
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  });
  executeApproved.mockResolvedValue({
    messages: [{ role: "assistant", content: "working" }],
    msg: { id: "m1", role: "assistant", status: "complete" },
    resolvedTurn,
  });
  buildDenial.mockReturnValue({
    resolvedTurn,
    messages: [{ role: "assistant", content: "working" }],
  });
  persistTurn.mockResolvedValue({ id: "m1", role: "assistant", status: "complete" });
  finalizeApprovalFlow.mockResolvedValue(undefined);
  cancelCurrentRun.mockResolvedValue(undefined);
  continueAgentLoop.mockResolvedValue({
    turns: [resolvedTurn],
    maxIterationsReached: false,
    messages: [{ role: "assistant", content: "approved run" }],
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  });
  executeApproved.mockResolvedValue({
    messages: [{ role: "assistant", content: "working" }],
    msg: { id: "m1", role: "assistant", status: "complete" },
    resolvedTurn,
  });
  buildDenial.mockReturnValue({
    resolvedTurn,
    messages: [{ role: "assistant", content: "working" }],
  });
  persistTurn.mockResolvedValue({ id: "m1", role: "assistant", status: "complete" });
});

describe("approveTool", () => {
  it("executes the approved tool, continues the loop, and persists approved", async () => {
    const pending = pendingApproval();
    const { set, get } = harness(pending);
    await approveTool(pending, set, get);

    expect(executeApproved).toHaveBeenCalledOnce();
    expect(continueAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conversation-1" }),
    );
    expect(finalizeApprovalFlow).toHaveBeenCalledOnce();
    const record = storageWrite.mock.calls.at(-1)?.[2];
    expect(record?.status).toBe("approved");
    expect(get().isStreaming).toBe(false);
    expect(get().activeStreamConversationId).toBeNull();
  });

  it("fails closed when no tool executor is available", async () => {
    const pending = pendingApproval();
    const { set, get } = harness(pending, {
      toolExecutor: undefined,
    } as unknown as Partial<EvirRuntime>);
    await approveTool(pending, set, get);
    expect(executeApproved).not.toHaveBeenCalled();
    expect(get().error).toBe("tools.notAvailable");
    expect(get().isStreaming).toBe(false);
  });
});

describe("denyTool", () => {
  it("persists a denial turn, continues the loop, and persists denied", async () => {
    const pending = pendingApproval();
    const { set, get } = harness(pending);
    await denyTool(pending, set, get);

    expect(buildDenial).toHaveBeenCalledWith(pending);
    expect(persistTurn).toHaveBeenCalledOnce();
    expect(continueAgentLoop).toHaveBeenCalledOnce();
    const record = storageWrite.mock.calls.at(-1)?.[2];
    expect(record?.status).toBe("denied");
    expect(get().isStreaming).toBe(false);
  });

  it("cancels the run when the continuation was stopped mid-flight", async () => {
    const pending = pendingApproval();
    const { set, get } = harness(pending);
    continueAgentLoop.mockResolvedValue({
      turns: [
        { stream: { content: "stopped", status: "stopped" }, toolCalls: [], toolResults: [] },
      ],
      maxIterationsReached: false,
      messages: [],
      agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
    });
    await denyTool(pending, set, get);

    expect(cancelCurrentRun).toHaveBeenCalledOnce();
    const record = storageWrite.mock.calls.at(-1)?.[2];
    expect(record?.status).toBe("denied");
  });
});
