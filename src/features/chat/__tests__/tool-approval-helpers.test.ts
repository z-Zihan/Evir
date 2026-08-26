import { describe, expect, it, vi } from "vitest";
import type { ToolExecutor } from "../../../core/tools/tool-executor";
import type { EvirRuntime } from "../../../runtime/types";
import { executeApproved } from "../tool-approval-helpers";
import {
  fromApprovalRecord,
  approvalContinuationStopped,
  toApprovalRecord,
  type ApprovalRecord,
  type PendingToolApproval,
} from "../tool-approval";

function pendingApproval(): PendingToolApproval {
  return {
    toolCallId: "call-1",
    toolName: "write_file",
    args: { path: "/workspace/file.txt" },
    conversationId: "conversation-1",
    messages: [{ role: "user", content: "Update the file" }],
    providerId: "provider-1",
    turn: {
      stream: { content: "", status: "complete" },
      toolCalls: [
        {
          id: "call-1",
          toolName: "write_file",
          arguments: { path: "/workspace/file.txt" },
        },
      ],
    },
    agentRun: { id: "agent-run-1", snapshots: [], fileReferences: [] },
    mode: "agent",
    allowedToolIds: ["write_file"],
  };
}

describe("tool approval continuation", () => {
  it("does not advance orchestration after the approval follow-up is stopped", () => {
    const active = new AbortController();
    const aborted = new AbortController();
    aborted.abort();

    expect(
      approvalContinuationStopped(active.signal, {
        stream: { content: "partial", status: "stopped" },
      }),
    ).toBe(true);
    expect(
      approvalContinuationStopped(aborted.signal, {
        stream: { content: "done", status: "complete" },
      }),
    ).toBe(true);
    expect(
      approvalContinuationStopped(active.signal, {
        stream: { content: "done", status: "complete" },
      }),
    ).toBe(false);
  });

  it("uses the approval flow signal for the approved tool execution", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "approved" }));
    const runtime = {
      target: "desktop",
      capabilities: new Set(["filesystem"]),
      has: (capability: string) => capability === "filesystem",
      toolExecutor: { execute } as unknown as ToolExecutor,
    } satisfies EvirRuntime;
    const pending = pendingApproval();
    const controller = new AbortController();

    await executeApproved(pending, runtime, false, controller.signal);

    expect(execute).toHaveBeenCalledWith(
      "write_file",
      pending.args,
      runtime,
      true,
      controller.signal,
    );
  });

  it("drops invalid persisted approval metadata at the storage boundary", () => {
    const record = toApprovalRecord(pendingApproval());
    const corrupted = {
      ...record,
      riskLevel: "root",
      source: "unknown",
      approval: {
        target: "server",
        impact: "arbitrary-impact",
        reversible: "sometimes",
      },
    } as unknown as ApprovalRecord;

    const restored = fromApprovalRecord(corrupted);

    expect(restored.riskLevel).toBeUndefined();
    expect(restored.source).toBeUndefined();
    expect(restored.approval).toBeUndefined();
  });
});
