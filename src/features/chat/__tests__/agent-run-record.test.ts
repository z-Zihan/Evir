import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../core/storage/db";
import type { EvirRuntime } from "../../../runtime/types";
import type { AgentLoopResult } from "../agent-loop";
import {
  applyAutomaticVerification,
  buildAgentRunRecord,
  rollbackAgentRun,
} from "../agent-run-record";

function resultWith(toolName?: string, success = true): AgentLoopResult {
  return {
    turns: [
      {
        stream: { content: "Done", status: "complete" },
        ...(toolName
          ? {
              toolCalls: [{ id: "call-1", toolName, arguments: {} }],
              toolResults: [{ toolCallId: "call-1", toolName, success, output: "result" }],
            }
          : {}),
      },
    ],
    maxIterationsReached: false,
    messages: [],
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("Agent run completion evidence", () => {
  it("does not mark model text alone as complete", () => {
    const record = buildAgentRunRecord(resultWith(), "conversation-1");
    expect(record.status).toBe("needs_verification");
    expect(record.resolution.complete).toBe(false);
  });

  it("accepts successful command evidence and rejects failed verification", () => {
    const passed = buildAgentRunRecord(resultWith("run_command"), "conversation-1");
    const failed = buildAgentRunRecord(resultWith("run_command", false), "conversation-1");
    expect(passed.status).toBe("completed");
    expect(passed.resolution.complete).toBe(true);
    expect(failed.status).toBe("failed");
    expect(failed.resolution.complete).toBe(false);
  });

  it("incorporates automatic workspace verification", () => {
    const record = buildAgentRunRecord(resultWith(), "conversation-1");
    const verified = applyAutomaticVerification(record, {
      command: "pnpm check",
      exitCode: 0,
      status: "passed",
      durationMs: 10,
      stdoutPreview: "ok",
      stderrPreview: "",
    });
    expect(verified.status).toBe("completed");
    expect(verified.resolution.complete).toBe(true);
  });
});

describe("Agent run rollback", () => {
  it("restores snapshots in reverse order and records rollback", async () => {
    const restoreSnapshot = vi.fn(() => Promise.resolve(true));
    const runtime = {
      target: "desktop",
      capabilities: new Set(["filesystem"]),
      has: () => true,
      storage: { restoreSnapshot },
    } as unknown as EvirRuntime;
    const base = buildAgentRunRecord(resultWith("git_diff"), "conversation-1");
    const record = {
      ...base,
      snapshots: [
        { snapshot_id: "one", file_path: "/tmp/one", existed: true, original_hash: "a" },
        { snapshot_id: "two", file_path: "/tmp/two", existed: false, original_hash: null },
      ],
    };

    const rolledBack = await rollbackAgentRun(record, runtime);

    expect(restoreSnapshot).toHaveBeenNthCalledWith(1, "two", "run-1", "/tmp/two");
    expect(restoreSnapshot).toHaveBeenNthCalledWith(2, "one", "run-1", "/tmp/one");
    expect(rolledBack.status).toBe("rolled_back");
    expect(await db.agentRuns.get("run-1")).toMatchObject({ status: "rolled_back" });
  });
});
