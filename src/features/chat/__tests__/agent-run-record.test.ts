import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessMiddlewareRegistry } from "../../../core/harness/middleware-registry";
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
  it("does not mark model text alone as complete", async () => {
    const record = await buildAgentRunRecord(resultWith(), "conversation-1");
    expect(record.status).toBe("needs_verification");
    expect(record.resolution.complete).toBe(false);
  });

  it("falls back to needs_verification when Verification middleware is disabled", async () => {
    const harnessMiddlewareRegistry = new HarnessMiddlewareRegistry();
    const runtime: EvirRuntime = {
      target: "desktop",
      capabilities: new Set(),
      has: () => false,
      harnessMiddlewareRegistry,
    };
    const record = await buildAgentRunRecord(resultWith("run_command"), "conversation-1", runtime);

    expect(record.status).toBe("needs_verification");
    expect(record.verificationEvidence).toEqual([]);
    expect(record.resolution).toEqual({
      complete: false,
      reason: "Verification middleware is disabled or unavailable.",
    });
  });

  it("accepts successful command evidence and rejects failed verification", async () => {
    const passed = await buildAgentRunRecord(resultWith("run_command"), "conversation-1");
    const failed = await buildAgentRunRecord(resultWith("run_command", false), "conversation-1");
    expect(passed.status).toBe("completed");
    expect(passed.resolution.complete).toBe(true);
    expect(failed.status).toBe("failed");
    expect(failed.resolution.complete).toBe(false);
  });

  it("incorporates automatic workspace verification", async () => {
    const record = await buildAgentRunRecord(resultWith(), "conversation-1");
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

  it("keeps files, snapshots, and tool evidence across an orchestrated continuation", async () => {
    const first = await buildAgentRunRecord(
      {
        ...resultWith("write_file"),
        agentRun: {
          id: "worker-run",
          snapshots: [
            {
              snapshot_id: "snapshot-1",
              file_path: "/tmp/output.txt",
              existed: false,
              original_hash: null,
            },
          ],
          fileReferences: [
            {
              path: "/tmp/output.txt",
              contentHash: "written",
              lastReadAt: 1,
              summary: "created output",
              stale: false,
            },
          ],
        },
      },
      "conversation-1",
      undefined,
      { runId: "run-1" },
    );
    const continued = await buildAgentRunRecord(
      {
        ...resultWith("git_status"),
        agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
        turns: [
          {
            stream: { content: "Verified", status: "complete" },
            toolCalls: [{ id: "call-2", toolName: "git_status", arguments: {} }],
            toolResults: [
              {
                toolCallId: "call-2",
                toolName: "git_status",
                success: true,
                output: "?? output.txt",
              },
            ],
          },
        ],
      },
      "conversation-1",
      undefined,
      { previous: first },
    );

    expect(continued.id).toBe("run-1");
    expect(continued.toolCalls.map(({ toolName }) => toolName)).toEqual([
      "write_file",
      "git_status",
    ]);
    expect(continued.snapshots).toHaveLength(1);
    expect(continued.fileReferences).toHaveLength(1);
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
    const base = await buildAgentRunRecord(resultWith("git_diff"), "conversation-1");
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
