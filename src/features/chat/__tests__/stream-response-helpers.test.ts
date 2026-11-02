// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ProviderRecord } from "../../../core/storage/db";
import type { AgentApprovalContext, AgentLoopResult, AgentLoopTurn } from "../agent-loop";
import type { StreamResult } from "../chat-stream";
import type { TurnContext } from "../turn/turn-state";

vi.mock("../../../i18n/config", () => ({
  default: {
    t: (key: string, options?: { toolNames?: string }) => `${key}:${options?.toolNames ?? ""}`,
  },
}));

vi.mock("../../provider/provider-store", () => ({
  useProviderStore: { getState: () => ({ getDefaultProvider: () => undefined }) },
}));

vi.mock("../../skills/skill-store", () => ({
  useSkillStore: {
    getState: () => ({
      skills: [],
      enabledSkillIds: new Set<string>(),
      getSkillContent: vi.fn().mockResolvedValue(""),
    }),
  },
}));

import { collectApprovals, explainToolCallWithoutAccess, traceStatusFor } from "../stream-response";

const provider = {
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
} satisfies ProviderRecord;

function toolCall(id: string, toolName: string) {
  return { id, toolName, arguments: "{}" };
}

function turnContext(toolIds?: string[]): TurnContext {
  const listForMode = vi.fn(() => (toolIds ?? []).map((id) => ({ id })));
  return {
    runtime: toolIds ? { toolRegistry: { listForMode } } : {},
    conversationId: "conversation-1",
    provider,
  } as unknown as TurnContext;
}

function loopTurn(
  pendingApproval?: AgentLoopTurn["pendingApproval"],
  stream: StreamResult = { content: "", status: "complete" },
): AgentLoopTurn {
  return { stream, ...(pendingApproval ? { pendingApproval } : {}) };
}

function loopResult(
  turns: AgentLoopTurn[],
  approvalContexts?: AgentApprovalContext[],
): AgentLoopResult {
  return {
    turns,
    maxIterationsReached: false,
    messages: [{ role: "user", content: "hello" }],
    agentRun: { id: "run-1", snapshots: [], fileReferences: [] },
    ...(approvalContexts ? { approvalContexts } : {}),
  };
}

function approvalContext(
  turn: AgentLoopTurn,
  overrides: Partial<AgentApprovalContext> = {},
): AgentApprovalContext {
  return {
    runId: "orch-run",
    nodeId: "node-1",
    mode: "goal",
    allowedToolIds: ["read_file"],
    messages: [{ role: "assistant", content: "context" }],
    turn,
    agentRun: { id: "context-run", snapshots: [], fileReferences: [] },
    ...overrides,
  };
}

const blockedWrite = {
  toolCallId: "call-1",
  toolName: "write_file",
  args: { path: "a.txt" },
};

describe("explainToolCallWithoutAccess", () => {
  it("returns the stream untouched when tool calls come with content", () => {
    const stream: StreamResult = {
      content: "Here is the answer",
      status: "complete",
      toolCalls: [toolCall("1", "read_file")],
    };
    expect(explainToolCallWithoutAccess(stream)).toBe(stream);
  });

  it("returns the stream untouched when there are no tool calls", () => {
    const withoutField: StreamResult = { content: "", status: "complete" };
    const emptyList: StreamResult = { content: "", status: "complete", toolCalls: [] };
    expect(explainToolCallWithoutAccess(withoutField)).toBe(withoutField);
    expect(explainToolCallWithoutAccess(emptyList)).toBe(emptyList);
  });

  it("replaces whitespace-only content with the no-tool-access explanation", () => {
    for (const content of ["", "  ", "\n\t "]) {
      const result = explainToolCallWithoutAccess({
        content,
        status: "complete",
        toolCalls: [toolCall("1", "read_file")],
      });
      expect(result.content).toBe("chat.toolCallWithoutToolAccess:read_file");
    }
  });

  it("deduplicates tool names and joins them with commas", () => {
    const result = explainToolCallWithoutAccess({
      content: "",
      status: "complete",
      toolCalls: [
        toolCall("1", "read_file"),
        toolCall("2", "shell"),
        toolCall("3", "read_file"),
        toolCall("4", "shell"),
      ],
    });
    expect(result.content).toBe("chat.toolCallWithoutToolAccess:read_file, shell");
    expect(result.content.match(/read_file/g)).toHaveLength(1);
    expect(result.content.match(/shell/g)).toHaveLength(1);
  });

  it("preserves the other stream fields when replacing content", () => {
    const toolCalls = [toolCall("1", "read_file")];
    const stream: StreamResult = {
      content: " ",
      status: "error",
      errorMessage: "boom",
      retryable: true,
      toolCalls,
    };
    const result = explainToolCallWithoutAccess(stream);
    expect(result).not.toBe(stream);
    expect(result).toEqual({
      content: "chat.toolCallWithoutToolAccess:read_file",
      status: "error",
      errorMessage: "boom",
      retryable: true,
      toolCalls,
    });
    expect(stream.content).toBe(" ");
  });
});

describe("collectApprovals", () => {
  it("returns nothing when there are no contexts and the last turn is not blocked", () => {
    const result = loopResult([loopTurn(blockedWrite), loopTurn()]);
    expect(collectApprovals(turnContext(["read_file"]), result)).toEqual({
      pendingApprovals: [],
      approvalContexts: [],
    });
  });

  it("falls back to a single agent context built from the blocked last turn", () => {
    const blockedTurn = loopTurn(blockedWrite);
    const result = loopResult([loopTurn(), blockedTurn]);
    const { approvalContexts, pendingApprovals } = collectApprovals(
      turnContext(["read_file", "write_file"]),
      result,
    );

    expect(approvalContexts).toEqual([
      {
        runId: "",
        nodeId: "",
        mode: "agent",
        allowedToolIds: ["read_file", "write_file"],
        messages: result.messages,
        turn: blockedTurn,
        agentRun: result.agentRun,
      },
    ]);
    expect(pendingApprovals).toHaveLength(1);
    const [pending] = pendingApprovals;
    expect(pending).toEqual({
      approvalId: expect.any(String) as string,
      toolCallId: "call-1",
      toolName: "write_file",
      args: { path: "a.txt" },
      conversationId: "conversation-1",
      messages: result.messages,
      providerId: "provider-1",
      turn: blockedTurn,
      agentRun: result.agentRun,
      mode: "agent",
      allowedToolIds: ["read_file", "write_file"],
    });
    // Empty runId/nodeId in the fallback context must not produce orchestration.
    expect(pending && "orchestration" in pending).toBe(false);
  });

  it("uses an empty allowlist when the runtime has no tool registry", () => {
    const result = loopResult([loopTurn(blockedWrite)]);
    const { approvalContexts, pendingApprovals } = collectApprovals(turnContext(), result);
    expect(approvalContexts[0]?.allowedToolIds).toEqual([]);
    expect(pendingApprovals[0]?.allowedToolIds).toEqual([]);
  });

  it("prefers explicit approvalContexts over the last-turn fallback", () => {
    const contextTurn = loopTurn({ ...blockedWrite, toolCallId: "call-ctx" });
    const contexts = [approvalContext(contextTurn)];
    const result = loopResult([loopTurn({ ...blockedWrite, toolCallId: "call-last" })], contexts);
    const turn = turnContext(["shell"]);

    const { approvalContexts, pendingApprovals } = collectApprovals(turn, result);
    expect(approvalContexts).toBe(contexts);
    expect(pendingApprovals.map(({ toolCallId }) => toolCallId)).toEqual(["call-ctx"]);
    expect(pendingApprovals[0]).toMatchObject({
      messages: contexts[0]?.messages,
      agentRun: contexts[0]?.agentRun,
      allowedToolIds: ["read_file"],
      mode: "goal",
      orchestration: { runId: "orch-run", nodeId: "node-1" },
    });
    const runtime = turn.runtime as unknown as {
      toolRegistry: { listForMode: ReturnType<typeof vi.fn> };
    };
    expect(runtime.toolRegistry.listForMode).not.toHaveBeenCalled();
  });

  it("skips contexts whose turn has no pending approval", () => {
    const contexts = [
      approvalContext(loopTurn()),
      approvalContext(loopTurn(blockedWrite)),
      approvalContext(loopTurn()),
    ];
    const { approvalContexts, pendingApprovals } = collectApprovals(
      turnContext(),
      loopResult([loopTurn()], contexts),
    );
    expect(approvalContexts).toHaveLength(3);
    expect(pendingApprovals).toHaveLength(1);
    expect(pendingApprovals[0]?.toolCallId).toBe("call-1");
  });

  it("carries optional blocked fields only when present", () => {
    const full = loopTurn({
      ...blockedWrite,
      riskLevel: "L3",
      source: "evir-local",
      approval: { target: "a.txt", impact: "local-process-access", reversible: true },
      workspaceRoot: "/repo",
    });
    const nullRoot = loopTurn({ ...blockedWrite, toolCallId: "call-null", workspaceRoot: null });
    const bare = loopTurn({ ...blockedWrite, toolCallId: "call-bare" });
    const { pendingApprovals } = collectApprovals(
      turnContext(),
      loopResult(
        [loopTurn()],
        [full, nullRoot, bare].map((turn) => approvalContext(turn)),
      ),
    );
    const [withAll, withNullRoot, withNone] = pendingApprovals;

    expect(withAll).toMatchObject({
      riskLevel: "L3",
      source: "evir-local",
      approval: { target: "a.txt", impact: "local-process-access", reversible: true },
      workspaceRoot: "/repo",
    });
    // null is a meaningful "no workspace" value and must survive the mapping.
    expect(withNullRoot && "workspaceRoot" in withNullRoot).toBe(true);
    expect(withNullRoot?.workspaceRoot).toBeNull();
    expect(withNullRoot && "riskLevel" in withNullRoot).toBe(false);
    for (const key of ["riskLevel", "source", "approval", "workspaceRoot"]) {
      expect(withNone && key in withNone).toBe(false);
    }
  });

  it("omits mode for ask contexts and orchestration without both run and node ids", () => {
    const contexts = [
      approvalContext(loopTurn({ ...blockedWrite, toolCallId: "ask" }), { mode: "ask" }),
      approvalContext(loopTurn({ ...blockedWrite, toolCallId: "no-node" }), { nodeId: "" }),
      approvalContext(loopTurn({ ...blockedWrite, toolCallId: "no-run" }), {
        runId: "",
        mode: "plan",
      }),
    ];
    const { pendingApprovals } = collectApprovals(
      turnContext(),
      loopResult([loopTurn()], contexts),
    );
    const [ask, noNode, noRun] = pendingApprovals;

    expect(ask && "mode" in ask).toBe(false);
    expect(ask?.orchestration).toEqual({ runId: "orch-run", nodeId: "node-1" });
    expect(noNode?.mode).toBe("goal");
    expect(noNode && "orchestration" in noNode).toBe(false);
    expect(noRun?.mode).toBe("plan");
    expect(noRun && "orchestration" in noRun).toBe(false);
  });

  it("produces one approval per blocked context with unique approval ids", () => {
    const contexts = ["a", "b", "c"].map((id) =>
      approvalContext(loopTurn({ ...blockedWrite, toolCallId: id }), { nodeId: `node-${id}` }),
    );
    const { pendingApprovals } = collectApprovals(
      turnContext(),
      loopResult([loopTurn()], contexts),
    );

    expect(pendingApprovals.map(({ toolCallId }) => toolCallId)).toEqual(["a", "b", "c"]);
    expect(pendingApprovals.map(({ orchestration }) => orchestration?.nodeId)).toEqual([
      "node-a",
      "node-b",
      "node-c",
    ]);
    for (const pending of pendingApprovals) {
      expect(pending.conversationId).toBe("conversation-1");
      expect(pending.providerId).toBe("provider-1");
    }
    expect(new Set(pendingApprovals.map(({ approvalId }) => approvalId)).size).toBe(3);
  });
});

describe("traceStatusFor", () => {
  const stopped = loopResult([loopTurn(undefined, { content: "partial", status: "stopped" })]);

  it("reports stopped when the last turn stopped, regardless of error", () => {
    expect(traceStatusFor(stopped, undefined)).toBe("stopped");
    expect(traceStatusFor(stopped, "tools.maxIterations")).toBe("stopped");
  });

  it("only considers the last turn's stream status", () => {
    const earlierStop = loopResult([
      loopTurn(undefined, { content: "", status: "stopped" }),
      loopTurn(undefined, { content: "done", status: "complete" }),
    ]);
    expect(traceStatusFor(earlierStop, undefined)).toBe("completed");
  });

  it("reports failed when an error is present and the run did not stop", () => {
    const errored = loopResult([loopTurn(undefined, { content: "", status: "error" })]);
    expect(traceStatusFor(errored, "chat.streamFailed")).toBe("failed");
  });

  it("reports completed when there is no error and the run did not stop", () => {
    expect(traceStatusFor(loopResult([loopTurn()]), undefined)).toBe("completed");
    expect(traceStatusFor(loopResult([]), undefined)).toBe("completed");
  });
});
