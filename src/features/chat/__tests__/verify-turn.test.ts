// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../../core/storage/db";
import type { EvirRuntime } from "../../../runtime/types";
import type { AgentLoopResult } from "../agent-loop";
import type { AgentRunRecord } from "../agent-run-record";

// Approach: agent-run-record is partially mocked — buildAgentRunRecord,
// persistAgentRun and finalizeAutomaticVerification become spies so the tests
// can pin down verifyTurn's own gating/ordering and the `previous` record it
// resolves. Everything else in that module stays real (importOriginal), and
// structured storage is an in-memory map that logs every read and write.

type StorageOp = { type: "read" | "write" | "delete"; entity: string; id: string; data?: unknown };

const { storageState, agentRunMocks } = vi.hoisted(() => ({
  storageState: {
    entities: new Map<string, Map<string, unknown>>(),
    ops: [] as StorageOp[],
  },
  agentRunMocks: {
    buildAgentRunRecord: vi.fn(),
    persistAgentRun: vi.fn(),
    finalizeAutomaticVerification: vi.fn(),
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
    read: (entity: string, id: string) => {
      storageState.ops.push({ type: "read", entity, id });
      return Promise.resolve(entityMap(entity).get(id));
    },
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

vi.mock("../agent-run-record", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-run-record")>();
  return { ...actual, ...agentRunMocks };
});

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
import { verifyTurn } from "../turn/verify-turn";
import type { TurnContext } from "../turn/turn-state";

const CONVERSATION_ID = "c1";
const RUN_ID = "run-1";

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

function makeRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: RUN_ID,
    conversationId: CONVERSATION_ID,
    status: "completed",
    toolCalls: [],
    toolResults: [],
    snapshots: [],
    fileReferences: [],
    verificationEvidence: [],
    resolution: { complete: true, reason: "done" },
    maxIterationsReached: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeResult(runId = RUN_ID): AgentLoopResult {
  return {
    turns: [],
    maxIterationsReached: false,
    messages: [],
    agentRun: { id: runId, snapshots: [], fileReferences: [] },
  };
}

function makeTurnContext(): TurnContext {
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
  };
}

function setStore(state: Partial<ChatState>): void {
  useChatStore.setState(state);
}

function previousPassedToBuild(): unknown {
  const call = agentRunMocks.buildAgentRunRecord.mock.calls[0] as
    [AgentLoopResult, string, EvirRuntime, { previous: AgentRunRecord | null }] | undefined;
  return call?.[3].previous;
}

const built = makeRecord({ status: "needs_verification" });
const finalized = makeRecord({ status: "completed", updatedAt: 2 });

beforeEach(() => {
  storageState.entities.clear();
  storageState.ops.length = 0;
  agentRunMocks.buildAgentRunRecord.mockReset().mockResolvedValue(built);
  agentRunMocks.persistAgentRun.mockReset().mockResolvedValue(undefined);
  agentRunMocks.finalizeAutomaticVerification.mockReset().mockResolvedValue(finalized);
  setStore({ privateSession: false, latestAgentRun: null });
});

describe("verifyTurn mode gate", () => {
  it.each(["ask", "plan"] as const)(
    "returns null for %s mode without touching storage",
    async (mode) => {
      const record = await verifyTurn(makeTurnContext(), makeResult(), runtime, mode);

      expect(record).toBeNull();
      expect(agentRunMocks.buildAgentRunRecord).not.toHaveBeenCalled();
      expect(agentRunMocks.persistAgentRun).not.toHaveBeenCalled();
      expect(agentRunMocks.finalizeAutomaticVerification).not.toHaveBeenCalled();
      expect(storageState.ops).toEqual([]);
    },
  );

  it.each(["agent", "goal"] as const)(
    "builds, persists and finalizes the record in %s mode",
    async (mode) => {
      const result = makeResult();
      const record = await verifyTurn(makeTurnContext(), result, runtime, mode);

      expect(agentRunMocks.buildAgentRunRecord).toHaveBeenCalledWith(
        result,
        CONVERSATION_ID,
        runtime,
        { previous: null },
      );
      expect(agentRunMocks.persistAgentRun).toHaveBeenCalledWith(built);
      expect(agentRunMocks.finalizeAutomaticVerification).toHaveBeenCalledWith(built, runtime);
      expect(agentRunMocks.persistAgentRun.mock.invocationCallOrder[0]).toBeLessThan(
        agentRunMocks.finalizeAutomaticVerification.mock.invocationCallOrder[0]!,
      );
      expect(record).toBe(finalized);
    },
  );
});

describe("verifyTurn private-session gate", () => {
  it("returns the built record without persisting or finalizing", async () => {
    setStore({ privateSession: true });

    const record = await verifyTurn(makeTurnContext(), makeResult(), runtime, "agent");

    expect(record).toBe(built);
    expect(agentRunMocks.persistAgentRun).not.toHaveBeenCalled();
    expect(agentRunMocks.finalizeAutomaticVerification).not.toHaveBeenCalled();
    expect(storageState.ops).toEqual([]);
  });

  it("returns null when buildAgentRunRecord yields nothing, skipping persistence", async () => {
    agentRunMocks.buildAgentRunRecord.mockResolvedValue(null);

    const record = await verifyTurn(makeTurnContext(), makeResult(), runtime, "agent");

    expect(record).toBeNull();
    expect(agentRunMocks.persistAgentRun).not.toHaveBeenCalled();
    expect(agentRunMocks.finalizeAutomaticVerification).not.toHaveBeenCalled();
  });
});

describe("verifyTurn previous-run resolution", () => {
  it("uses the in-store latestAgentRun when its id matches, without reading storage", async () => {
    const latest = makeRecord({ status: "awaiting_approval" });
    entityMap("agent_runs").set(RUN_ID, makeRecord({ status: "failed" }));
    setStore({ latestAgentRun: latest });

    await verifyTurn(makeTurnContext(), makeResult(), runtime, "agent");

    expect(previousPassedToBuild()).toBe(latest);
    expect(storageState.ops.filter((op) => op.type === "read")).toEqual([]);
  });

  it("uses the in-store run even in a private session when ids match", async () => {
    const latest = makeRecord({ status: "awaiting_approval" });
    setStore({ latestAgentRun: latest, privateSession: true });

    await verifyTurn(makeTurnContext(), makeResult(), runtime, "goal");

    expect(previousPassedToBuild()).toBe(latest);
  });

  it("resolves null in a private session when ids differ, without reading storage", async () => {
    entityMap("agent_runs").set(RUN_ID, makeRecord());
    setStore({ latestAgentRun: makeRecord({ id: "other-run" }), privateSession: true });

    await verifyTurn(makeTurnContext(), makeResult(), runtime, "agent");

    expect(previousPassedToBuild()).toBeNull();
    expect(storageState.ops).toEqual([]);
  });

  it("reads the stored run when ids differ outside a private session", async () => {
    const stored = makeRecord({ status: "awaiting_approval", updatedAt: 5 });
    entityMap("agent_runs").set(RUN_ID, stored);
    setStore({ latestAgentRun: makeRecord({ id: "other-run" }) });

    await verifyTurn(makeTurnContext(), makeResult(), runtime, "agent");

    expect(previousPassedToBuild()).toBe(stored);
    expect(storageState.ops).toEqual([{ type: "read", entity: "agent_runs", id: RUN_ID }]);
  });

  it("resolves null when storage has no run for the id", async () => {
    await verifyTurn(makeTurnContext(), makeResult(), runtime, "agent");

    expect(previousPassedToBuild()).toBeNull();
    expect(storageState.ops).toEqual([{ type: "read", entity: "agent_runs", id: RUN_ID }]);
  });
});

describe("verifyTurn failure propagation", () => {
  it("rejects when finalizeAutomaticVerification rejects, after persisting", async () => {
    const failure = new Error("verification crashed");
    agentRunMocks.finalizeAutomaticVerification.mockRejectedValue(failure);

    await expect(verifyTurn(makeTurnContext(), makeResult(), runtime, "agent")).rejects.toBe(
      failure,
    );
    expect(agentRunMocks.persistAgentRun).toHaveBeenCalledWith(built);
  });

  it("rejects without finalizing when persistAgentRun rejects", async () => {
    const failure = new Error("disk full");
    agentRunMocks.persistAgentRun.mockRejectedValue(failure);

    await expect(verifyTurn(makeTurnContext(), makeResult(), runtime, "goal")).rejects.toBe(
      failure,
    );
    expect(agentRunMocks.finalizeAutomaticVerification).not.toHaveBeenCalled();
  });
});
