import { describe, expect, it } from "vitest";
import { createLoopDetectionMiddleware } from "../components/builtin-harness-components";
import { HarnessMiddlewareRegistry } from "../../core/harness/middleware-registry";
import type { HarnessToolCallEvent } from "../../core/harness/types";

function registry(): HarnessMiddlewareRegistry {
  const host = new HarnessMiddlewareRegistry();
  host.registerProtected(
    createLoopDetectionMiddleware({
      warnRepeatedToolCalls: 6,
      stopRepeatedToolCalls: 12,
      stopUnchangedErrors: 12,
      stopFailedRetries: 2,
    }),
    "evir.host.tool-policy",
  );
  return host;
}

function beforeExecute(toolName: string): HarnessToolCallEvent {
  return {
    type: "tool-call",
    phase: "before-execute",
    conversationId: "c1",
    runId: "r1",
    mode: "agent",
    toolName,
    arguments: { path: "input.txt" },
    allowedToolIds: new Set([toolName]),
    blocked: false,
  };
}

function afterExecute(
  toolName: string,
  result: { success: boolean; error?: string },
): HarnessToolCallEvent {
  return {
    ...beforeExecute(toolName),
    phase: "after-execute",
    result: {
      id: "t1",
      toolCallId: "call-1",
      toolName,
      ...result,
      output: "",
      startedAt: 1,
      endedAt: 2,
    },
  } as HarnessToolCallEvent;
}

describe("loop detection stopFailedRetries", () => {
  it("stops a call after it fails the configured number of times in a row", async () => {
    const harness = registry();
    // 第 1、2 次尝试：执行且失败
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await harness.dispatch(beforeExecute("read_file"));
      expect(before.blocked).toBe(false);
      const after = await harness.dispatch(
        afterExecute("read_file", { success: false, error: "TOOL_NOT_AVAILABLE" }),
      );
      expect(after.blocked).toBe(false);
    }
    // 第 3 次尝试：相同调用已连续失败 2 次 → 停止
    const blocked = await harness.dispatch(beforeExecute("read_file"));
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockReason).toBe("loop-detected");
    expect(blocked.loopSignal?.type).toBe("repeated-failed-call");
    expect(blocked.loopSignal?.occurrences).toBe(2);
  });

  it("resets the failure streak after a success", async () => {
    const harness = registry();
    await harness.dispatch(beforeExecute("read_file"));
    await harness.dispatch(afterExecute("read_file", { success: false, error: "E1" }));
    await harness.dispatch(beforeExecute("read_file"));
    await harness.dispatch(afterExecute("read_file", { success: false, error: "E1" }));
    // 成功一次 → 连续失败计数清零
    await harness.dispatch(beforeExecute("read_file"));
    await harness.dispatch(afterExecute("read_file", { success: true }));
    const retry = await harness.dispatch(beforeExecute("read_file"));
    expect(retry.blocked).toBe(false);
  });

  it("tracks different arguments independently", async () => {
    const harness = registry();
    const callA = () => beforeExecute("read_file");
    await harness.dispatch(callA());
    await harness.dispatch(afterExecute("read_file", { success: false, error: "E" }));
    await harness.dispatch(callA());
    await harness.dispatch(afterExecute("read_file", { success: false, error: "E" }));
    // 不同参数的调用不受另一参数失败计数影响
    const other: HarnessToolCallEvent = { ...callA(), arguments: { path: "other.txt" } };
    const allowed = await harness.dispatch(other);
    expect(allowed.blocked).toBe(false);
  });

  it("still allows the same call when failures are interleaved with other tools", async () => {
    const harness = registry();
    await harness.dispatch(beforeExecute("read_file"));
    await harness.dispatch(afterExecute("read_file", { success: false, error: "E" }));
    await harness.dispatch(beforeExecute("list_directory"));
    await harness.dispatch(afterExecute("list_directory", { success: true }));
    await harness.dispatch(beforeExecute("read_file"));
    await harness.dispatch(afterExecute("read_file", { success: false, error: "E" }));
    const third = await harness.dispatch(beforeExecute("read_file"));
    expect(third.blocked).toBe(true);
  });
});
