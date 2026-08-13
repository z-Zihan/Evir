import { describe, expect, it, vi } from "vitest";
import type { ToolExecutor } from "../../../core/tools/tool-executor";
import type { EvirRuntime } from "../../../runtime/types";
import { executeApproved } from "../tool-approval-helpers";
import type { PendingToolApproval } from "../tool-approval";

describe("tool approval continuation", () => {
  it("uses the approval flow signal for the approved tool execution", async () => {
    const execute = vi.fn(() => Promise.resolve({ success: true, output: "approved" }));
    const runtime = {
      target: "desktop",
      capabilities: new Set(["filesystem"]),
      has: (capability: string) => capability === "filesystem",
      toolExecutor: { execute } as unknown as ToolExecutor,
    } satisfies EvirRuntime;
    const pending: PendingToolApproval = {
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
});
