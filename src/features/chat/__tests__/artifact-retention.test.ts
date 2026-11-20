import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRecord } from "../../../core/storage/db";
import type { EntityName, StorageMutation, StoragePort } from "../../../core/storage/storage-port";
import { logger } from "../../../core/logging/logger";
import {
  ARTIFACT_RETENTION_INTERVAL_MS,
  resetArtifactRetentionScheduleForTests,
  runArtifactRetention,
  scheduleArtifactRetention,
} from "../artifact-retention";

vi.mock("../../../runtime/structured-storage", () => ({
  getStructuredStorage: vi.fn(),
}));

import { getStructuredStorage } from "../../../runtime/structured-storage";

type Row = { id: string } & Record<string, unknown>;

class MemoryStorage implements StoragePort {
  readonly tables = new Map<EntityName, Map<string, Row>>();
  readonly applied: StorageMutation[][] = [];

  private table(entity: EntityName): Map<string, Row> {
    let table = this.tables.get(entity);
    if (!table) {
      table = new Map();
      this.tables.set(entity, table);
    }
    return table;
  }

  seed(entity: EntityName, rows: Row[]): void {
    for (const row of rows) this.table(entity).set(row.id, row);
  }

  ids(entity: EntityName): string[] {
    return [...this.table(entity).keys()].sort();
  }

  read<T>(entity: EntityName, id: string): Promise<T | undefined> {
    return Promise.resolve(this.table(entity).get(id) as T | undefined);
  }
  readAll<T>(entity: EntityName): Promise<T[]> {
    return Promise.resolve([...this.table(entity).values()] as T[]);
  }
  write<T>(entity: EntityName, id: string, data: T): Promise<void> {
    this.table(entity).set(id, data as Row);
    return Promise.resolve();
  }
  writeMany<T>(entity: EntityName, data: T[]): Promise<void> {
    for (const row of data as Row[]) this.table(entity).set(row.id, row);
    return Promise.resolve();
  }
  delete(entity: EntityName, id: string): Promise<void> {
    this.table(entity).delete(id);
    return Promise.resolve();
  }
  deleteMany(entity: EntityName, ids: string[]): Promise<void> {
    for (const id of ids) this.table(entity).delete(id);
    return Promise.resolve();
  }
  clear(entity: EntityName): Promise<void> {
    this.table(entity).clear();
    return Promise.resolve();
  }
  query<T>(entity: EntityName, filter: Partial<T>): Promise<T[]> {
    const entries = Object.entries(filter as Record<string, unknown>);
    return Promise.resolve(
      [...this.table(entity).values()].filter((row) =>
        entries.every(([key, value]) => row[key] === value),
      ) as T[],
    );
  }
  apply(mutations: StorageMutation[]): Promise<void> {
    this.applied.push(mutations);
    for (const mutation of mutations) {
      if (mutation.type === "delete") this.table(mutation.entity).delete(mutation.id);
      else if (mutation.type === "clear") this.table(mutation.entity).clear();
      else this.table(mutation.entity).set(mutation.id, { ...mutation.data, id: mutation.id });
    }
    return Promise.resolve();
  }
}

function conversation(id: string): Row {
  return { id, title: id, createdAt: 1, updatedAt: 1 };
}

function summaryArchive(id: string, conversationId: string): Row {
  return {
    id,
    type: "conversation-summary-source",
    relatedEntityId: conversationId,
    createdAt: 1,
  };
}

function toolOutput(toolCallId: string, conversationId: string): Row {
  return {
    id: `tool-output-${toolCallId}`,
    type: "tool-output-source",
    relatedEntityId: conversationId,
    toolCallId,
    toolName: "read_file",
    output: "full output",
    createdAt: 1,
  };
}

function storedArtifact(id: string, createdAt: number): Row {
  return { id, relatedEntityId: null, createdAt, language: "ts", content: "x" };
}

function message(id: string, conversationId: string, extra: Partial<MessageRecord> = {}): Row {
  return {
    id,
    conversationId,
    role: "assistant",
    content: "",
    status: "complete",
    createdAt: 1,
    ...extra,
  } satisfies MessageRecord;
}

function summaryMessage(id: string, conversationId: string, archiveId: string): Row {
  return message(id, conversationId, {
    summaryMetadata: {
      version: 1,
      sourceMessageIds: [],
      sourceStartedAt: 0,
      sourceEndedAt: 0,
      archiveId,
    },
  });
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runArtifactRetention — orphan sweep (P1a)", () => {
  it("deletes a summary archive whose conversation is gone and is unreferenced", async () => {
    storage.seed("artifacts", [summaryArchive("summary-1", "gone")]);

    const result = await runArtifactRetention(storage);

    expect(result.deletedOrphanSummaries).toBe(1);
    expect(storage.ids("artifacts")).toEqual([]);
  });

  it("keeps a summary archive whose conversation still exists, even without references", async () => {
    // Rule (a) is conservative: only conversation-gone archives are orphans.
    storage.seed("conversations", [conversation("conv-1")]);
    storage.seed("artifacts", [summaryArchive("summary-1", "conv-1")]);

    const result = await runArtifactRetention(storage);

    expect(result.deletedOrphanSummaries).toBe(0);
    expect(storage.ids("artifacts")).toEqual(["summary-1"]);
  });

  it("keeps a conversation-gone summary archive still referenced by any message", async () => {
    storage.seed("conversations", [conversation("branch")]);
    storage.seed("artifacts", [summaryArchive("summary-1", "gone")]);
    storage.seed("messages", [summaryMessage("m-1", "branch", "summary-1")]);

    const result = await runArtifactRetention(storage);

    expect(result.deletedOrphanSummaries).toBe(0);
    expect(storage.ids("artifacts")).toEqual(["summary-1"]);
  });

  it("keeps a tool-output archive whose conversation exists", async () => {
    storage.seed("conversations", [conversation("conv-1")]);
    storage.seed("artifacts", [toolOutput("call-1", "conv-1")]);

    const result = await runArtifactRetention(storage);

    expect(result.deletedOrphanToolOutputs).toBe(0);
    expect(storage.ids("artifacts")).toEqual(["tool-output-call-1"]);
  });

  it("deletes a tool-output archive whose conversation is gone", async () => {
    storage.seed("artifacts", [toolOutput("call-1", "gone")]);

    const result = await runArtifactRetention(storage);

    expect(result.deletedOrphanToolOutputs).toBe(1);
    expect(storage.ids("artifacts")).toEqual([]);
  });

  it("keeps a conversation-gone tool-output archive still referenced by a branch's marker", async () => {
    storage.seed("conversations", [conversation("branch")]);
    storage.seed("artifacts", [toolOutput("call-1", "gone")]);
    storage.seed("messages", [
      message("m-1", "branch", {
        toolResults: [
          {
            toolCallId: "call-1",
            toolName: "read_file",
            success: true,
            output: "[archived: tool-output-call-1]",
          },
        ],
      }),
    ]);

    const result = await runArtifactRetention(storage);

    expect(result.deletedOrphanToolOutputs).toBe(0);
    expect(storage.ids("artifacts")).toEqual(["tool-output-call-1"]);
  });

  it("never treats StoredArtifacts (relatedEntityId null) as orphans", async () => {
    storage.seed("artifacts", [storedArtifact("chat-artifact-a-1", 1)]);

    const result = await runArtifactRetention(storage);

    expect(result).toEqual({
      deletedOrphanSummaries: 0,
      deletedOrphanToolOutputs: 0,
      deletedLruStoredArtifacts: 0,
    });
    expect(storage.ids("artifacts")).toEqual(["chat-artifact-a-1"]);
  });
});

describe("runArtifactRetention — StoredArtifact LRU (P1b)", () => {
  it("keeps everything when the count equals the limit", async () => {
    storage.seed("artifacts", [
      storedArtifact("a", 1),
      storedArtifact("b", 2),
      storedArtifact("c", 3),
    ]);

    const result = await runArtifactRetention(storage, { storedArtifactLimit: 3 });

    expect(result.deletedLruStoredArtifacts).toBe(0);
    expect(storage.ids("artifacts")).toEqual(["a", "b", "c"]);
    expect(storage.applied).toEqual([]);
  });

  it("deletes only the oldest when one over the limit and keeps the newest", async () => {
    storage.seed("artifacts", [
      storedArtifact("newest", 40),
      storedArtifact("oldest", 10),
      storedArtifact("middle", 20),
      storedArtifact("recent", 30),
    ]);

    const result = await runArtifactRetention(storage, { storedArtifactLimit: 3 });

    expect(result.deletedLruStoredArtifacts).toBe(1);
    expect(storage.ids("artifacts")).toEqual(["middle", "newest", "recent"]);
  });

  it("defaults the limit to 200", async () => {
    storage.seed(
      "artifacts",
      Array.from({ length: 201 }, (_, index) => storedArtifact(`s-${index}`, index)),
    );

    const result = await runArtifactRetention(storage);

    expect(result.deletedLruStoredArtifacts).toBe(1);
    expect(storage.ids("artifacts")).not.toContain("s-0");
    expect(storage.ids("artifacts")).toHaveLength(200);
  });
});

describe("runArtifactRetention — batching, counts, logging, errors", () => {
  it("returns per-kind counts, deletes in one apply batch, and logs a summary", async () => {
    const info = vi.spyOn(logger, "info");
    storage.seed("conversations", [conversation("live")]);
    storage.seed("artifacts", [
      summaryArchive("summary-gone", "gone"),
      summaryArchive("summary-live", "live"),
      toolOutput("call-gone-1", "gone"),
      toolOutput("call-gone-2", "gone"),
      toolOutput("call-live", "live"),
      storedArtifact("old", 1),
      storedArtifact("new", 2),
    ]);

    const result = await runArtifactRetention(storage, { storedArtifactLimit: 1 });

    expect(result).toEqual({
      deletedOrphanSummaries: 1,
      deletedOrphanToolOutputs: 2,
      deletedLruStoredArtifacts: 1,
    });
    expect(storage.applied).toHaveLength(1);
    expect(storage.applied[0]).toHaveLength(4);
    expect(storage.ids("artifacts")).toEqual(["new", "summary-live", "tool-output-call-live"]);
    expect(info).toHaveBeenCalledWith(
      "artifact",
      "artifact.retention-swept",
      expect.objectContaining({ ...result, scannedArtifacts: 7 }),
    );
  });

  it("swallows storage failures and logs a warning", async () => {
    const warn = vi.spyOn(logger, "warn");
    storage.seed("artifacts", [toolOutput("call-1", "gone")]);
    vi.spyOn(storage, "apply").mockRejectedValue(new Error("quota exceeded"));

    await expect(runArtifactRetention(storage)).resolves.toEqual({
      deletedOrphanSummaries: 0,
      deletedOrphanToolOutputs: 0,
      deletedLruStoredArtifacts: 0,
    });
    expect(warn).toHaveBeenCalledWith(
      "artifact",
      "artifact.retention-failed",
      expect.objectContaining({ error: "quota exceeded" }),
    );
  });
});

describe("scheduleArtifactRetention", () => {
  beforeEach(() => {
    resetArtifactRetentionScheduleForTests();
    vi.mocked(getStructuredStorage).mockReturnValue(storage);
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetArtifactRetentionScheduleForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs exactly once across repeated calls via the setTimeout fallback", async () => {
    vi.stubGlobal("window", {});
    const readAll = vi.spyOn(storage, "readAll");

    scheduleArtifactRetention();
    scheduleArtifactRetention();
    expect(readAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(readAll).toHaveBeenCalledWith("artifacts");
    expect(readAll.mock.calls.filter(([entity]) => entity === "artifacts")).toHaveLength(1);
  });

  it("prefers requestIdleCallback when available", () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback });

    scheduleArtifactRetention();
    scheduleArtifactRetention();

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000 });
  });

  function artifactSweeps(readAll: { mock: { calls: unknown[][] } }): number {
    return readAll.mock.calls.filter(([entity]) => entity === "artifacts").length;
  }

  it("re-runs the sweep every 24h after the startup run", async () => {
    vi.stubGlobal("window", {});
    const readAll = vi.spyOn(storage, "readAll");

    scheduleArtifactRetention();
    scheduleArtifactRetention();
    await vi.advanceTimersByTimeAsync(ARTIFACT_RETENTION_INTERVAL_MS);

    expect(artifactSweeps(readAll)).toBe(2);
  });

  it("does not re-run before 24h have elapsed", async () => {
    vi.stubGlobal("window", {});
    const readAll = vi.spyOn(storage, "readAll");

    scheduleArtifactRetention();
    await vi.advanceTimersByTimeAsync(ARTIFACT_RETENTION_INTERVAL_MS - 1);

    expect(artifactSweeps(readAll)).toBe(1);
  });

  it("clears the periodic sweep on reset and allows rescheduling", async () => {
    vi.stubGlobal("window", {});
    const readAll = vi.spyOn(storage, "readAll");

    scheduleArtifactRetention();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(artifactSweeps(readAll)).toBe(1);

    resetArtifactRetentionScheduleForTests();
    await vi.advanceTimersByTimeAsync(ARTIFACT_RETENTION_INTERVAL_MS);
    expect(artifactSweeps(readAll)).toBe(1);

    scheduleArtifactRetention();
    await vi.advanceTimersByTimeAsync(ARTIFACT_RETENTION_INTERVAL_MS);
    expect(artifactSweeps(readAll)).toBe(3);
  });
});
