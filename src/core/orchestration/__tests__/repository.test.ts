import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvirDB } from "../../storage/db";
import { IndexedDBAdapter } from "../../storage/indexed-db-adapter";
import { createRunEvent, OrchestrationRepository } from "../repository";
import type { PlanGraph, TaskBrief } from "../types";
import type { StoragePort } from "../../storage/storage-port";

let database: EvirDB;
let repository: OrchestrationRepository;

const brief: TaskBrief = {
  id: "brief-1",
  runId: "run-1",
  conversationId: "conversation-1",
  goalKind: "change",
  objective: "Change a file",
  constraints: [],
  deliverables: ["file"],
  acceptanceCriteria: ["test passes"],
  requiredCapabilities: ["filesystem"],
  assumptions: [],
  unknowns: [],
  risk: "medium",
  clarificationRound: 2,
  version: 1,
  createdAt: 1,
  updatedAt: 2,
};

const plan: PlanGraph = {
  id: "plan-1",
  runId: brief.runId,
  conversationId: brief.conversationId,
  briefVersion: 1,
  revision: 1,
  nodes: [
    {
      id: "inspect",
      kind: "task",
      title: "Inspect",
      objective: "Inspect",
      dependencies: [],
      requiredCapabilities: ["filesystem"],
      resourceScopes: [{ kind: "workspace", value: "/workspace", access: "read" }],
      expectedArtifacts: [],
      successCriteria: [],
      status: "ready",
    },
  ],
  edges: [],
  status: "paused",
  requiresConfirmation: false,
  createdAt: 1,
  updatedAt: 2,
};

beforeEach(async () => {
  database = new EvirDB(`orchestration-${crypto.randomUUID()}`);
  await database.open();
  repository = new OrchestrationRepository(new IndexedDBAdapter(database));
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe("OrchestrationRepository", () => {
  it("restores the latest event-backed snapshot for a conversation", async () => {
    await repository.persistBrief(brief);
    await repository.persistPlan(plan);
    await repository.appendEvent(
      createRunEvent("run.paused", brief.runId, brief.conversationId, "Paused"),
    );

    const restored = await repository.loadLatestSnapshotForConversation(brief.conversationId);
    expect(restored?.runId).toBe(brief.runId);
    expect(restored?.phase).toBe("paused");
    expect(restored?.plan?.nodes[0]?.status).toBe("ready");
    expect(restored?.events.map(({ type }) => type)).toEqual(["run.paused"]);
  });

  it("writes events before derived snapshots in one storage transaction", async () => {
    const apply = vi.fn<StoragePort["apply"]>(() => Promise.resolve());
    const transactional = new OrchestrationRepository({ apply } as unknown as StoragePort);
    const event = createRunEvent("plan.created", brief.runId, brief.conversationId, "Created");

    await transactional.persistSnapshot(
      {
        runId: brief.runId,
        conversationId: brief.conversationId,
        phase: "execution",
        brief,
        plan,
        assignments: [],
        events: [event],
      },
      [event],
    );

    const mutations = apply.mock.calls[0]?.[0];
    expect(mutations?.[0]).toMatchObject({ entity: "run_events", id: event.id });
    expect(mutations?.[1]).toMatchObject({ entity: "task_briefs", id: brief.id });
    expect(mutations?.[2]).toMatchObject({ entity: "plans", id: plan.id });
  });

  it("restores an interrupted running plan as paused with active nodes blocked", async () => {
    await repository.persistBrief(brief);
    await repository.persistPlan({
      ...plan,
      status: "running",
      nodes: plan.nodes.map((node) => ({ ...node, status: "running" as const })),
    });

    const restored = await repository.loadSnapshot(brief.runId);

    expect(restored?.phase).toBe("paused");
    expect(restored?.plan?.status).toBe("paused");
    expect(restored?.plan?.nodes[0]?.status).toBe("blocked");
  });
});
