// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRecord, PendingToolApproval } from "../tool-approval";

const stores = vi.hoisted(() => {
  const map: Record<string, Record<string, unknown>> = {};
  return map;
});
vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: () => ({
    query: async (
      entity: string,
      filters: Record<string, unknown>,
    ): Promise<Record<string, unknown>[]> => {
      await Promise.resolve();
      const rows = Object.values(stores[entity] ?? {}) as Record<string, unknown>[];
      return rows.filter((row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value),
      );
    },
    readAll: async (entity: string): Promise<unknown[]> => {
      await Promise.resolve();
      return Object.values(stores[entity] ?? {});
    },
    write: async (entity: string, id: string, data: unknown): Promise<void> => {
      await Promise.resolve();
      stores[entity] = stores[entity] ?? {};
      stores[entity][id] = data;
    },
    apply: async (ops: { type: string; entity: string; id: string; data?: unknown }[]) => {
      await Promise.resolve();
      for (const op of ops) {
        const entity = (stores[op.entity] ??= {});
        if (op.type === "write") entity[op.id] = op.data;
        else delete entity[op.id];
      }
    },
  }),
  __stores: stores,
}));

const orchestrationStorageMock = {
  loadLatestSnapshotForConversation: async (): Promise<null> => {
    await Promise.resolve();
    return null;
  },
};
vi.mock("../../orchestration/repository", () => ({
  OrchestrationRepository: class {
    constructor() {
      return orchestrationStorageMock;
    }
  },
}));
vi.mock("../../../core/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), bindConversationCorrelation: vi.fn() },
}));

import { selectConversation } from "../conversation-ops";
import { useChatStore } from "../chat-store";

function blockedTurn(toolCallId: string) {
  return {
    stream: { content: "working", status: "complete" as const },
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

async function seedConversationWithApproval(id: string, approvalId: string, toolCallId: string) {
  const { getStructuredStorage } = await import("../../../runtime/structured-storage");
  const storage = getStructuredStorage() as unknown as {
    write(entity: string, id: string, d: unknown): Promise<void>;
  };
  await storage.write("conversations", id, {
    id,
    title: "T",
    providerId: "p",
    modelId: "m",
    createdAt: 1,
    updatedAt: 1,
    projectId: null,
  });
  await storage.write("messages", `u-${id}`, {
    id: `u-${id}`,
    conversationId: id,
    role: "user",
    content: "do it",
    status: "complete",
    createdAt: 10,
  });
  const pending: PendingToolApproval = {
    approvalId,
    toolCallId,
    toolName: "write_file",
    args: { path: "a.md" },
    conversationId: id,
    messages: [],
    providerId: "p",
    turn: blockedTurn(toolCallId),
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  };
  await storage.write("approvals", approvalId, {
    id: approvalId,
    runId: "run-1",
    nodeId: "legacy-agent-loop",
    conversationId: id,
    status: "pending",
    toolCallId,
    toolName: "write_file",
    args: pending.args,
    messages: pending.messages,
    providerId: pending.providerId,
    turn: pending.turn,
    agentRun: pending.agentRun,
    mode: "agent",
    allowedToolIds: [],
    createdAt: 20,
    updatedAt: 20,
  } satisfies ApprovalRecord);
}

describe("background approval visibility on conversation select", () => {
  beforeEach(async () => {
    const storageModule = (await import("../../../runtime/structured-storage")) as unknown as {
      __stores: Record<string, Record<string, unknown>>;
    };
    for (const key of Object.keys(storageModule.__stores ?? {})) delete storageModule.__stores[key];
    useChatStore.setState({
      conversations: [],
      currentConversationId: null,
      messages: [],
      pendingApprovals: {},
      pendingToolApproval: null,
      streamSlots: {},
      runOutcomes: {},
      conversationViewedAt: {},
    });
  });

  it("synthesizes the blocked turn for a backgrounded first-round approval", async () => {
    await seedConversationWithApproval("conv-1", "appr-1", "call-1");
    await selectConversation(useChatStore.setState, useChatStore.getState, "conv-1");
    const state = useChatStore.getState();
    // The approval surfaced from storage…
    expect(state.pendingToolApproval?.approvalId).toBe("appr-1");
    // …and its blocked tool call is visible as a message so the approval
    // panel can actually render for the user.
    const blocked = state.messages.find((message) =>
      message.toolCalls?.some((call) => call.id === "call-1"),
    );
    expect(blocked).toBeDefined();
    expect(
      blocked?.toolResults?.some(
        (result) => result.toolCallId === "call-1" && result.error === "permission_required",
      ),
    ).toBe(true);
  });

  it("does not duplicate the blocked turn when it was already persisted", async () => {
    await seedConversationWithApproval("conv-1", "appr-1", "call-1");
    const { getStructuredStorage } = await import("../../../runtime/structured-storage");
    const storage = getStructuredStorage() as unknown as {
      write(entity: string, id: string, d: unknown): Promise<void>;
    };
    // Continuation path: the blocked turn IS persisted as a message.
    await storage.write("messages", "blocked-1", {
      id: "blocked-1",
      conversationId: "conv-1",
      role: "assistant",
      content: "working",
      status: "complete",
      toolCalls: [{ id: "call-1", toolName: "write_file", arguments: { path: "a.md" } }],
      toolResults: [
        {
          toolCallId: "call-1",
          toolName: "write_file",
          success: false,
          output: "",
          error: "permission_required",
        },
      ],
      createdAt: 30,
    });
    await selectConversation(useChatStore.setState, useChatStore.getState, "conv-1");
    const calls = useChatStore
      .getState()
      .messages.filter((message) => message.toolCalls?.some((call) => call.id === "call-1"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("blocked-1");
  });
});
