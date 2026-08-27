import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanGraph, TaskBrief } from "../../../core/orchestration/types";
import type { ProviderRecord } from "../../../core/storage/db";
import { createToolRegistry } from "../../../core/tools/tool-registry-impl";
import type { EvirRuntime } from "../../../runtime/types";
import { runAgentLoop } from "../../chat/agent-loop";
import { useOrchestrationStore } from "../orchestration-store";
import { runOrchestratedAgent } from "../run-orchestrated-agent";

vi.mock("../../chat/agent-loop", () => ({ runAgentLoop: vi.fn() }));

const provider: ProviderRecord = {
  id: "provider-1",
  name: "Provider",
  protocolId: "openai-chat-completions",
  baseUrl: "https://example.test/v1",
  apiKey: "test",
  modelId: "model-1",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

const brief: TaskBrief = {
  id: "brief-1",
  runId: "run-1",
  conversationId: "conversation-1",
  goalKind: "inspect",
  objective: "Inspect two independent areas",
  constraints: [],
  deliverables: ["report"],
  acceptanceCriteria: [],
  requiredCapabilities: ["chat"],
  assumptions: [],
  unknowns: [],
  risk: "low",
  clarificationRound: 0,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

const plan: PlanGraph = {
  id: "plan-1",
  runId: "run-1",
  conversationId: "conversation-1",
  briefVersion: 1,
  revision: 1,
  nodes: [
    {
      id: "worker-a",
      kind: "subagent",
      title: "Worker A",
      objective: "Inspect A",
      dependencies: [],
      requiredCapabilities: [],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: [],
      status: "ready",
    },
    {
      id: "worker-b",
      kind: "subagent",
      title: "Worker B",
      objective: "Inspect B",
      dependencies: [],
      requiredCapabilities: [],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: [],
      status: "ready",
    },
    {
      id: "join",
      kind: "join",
      title: "Join",
      objective: "Join reports",
      dependencies: ["worker-a", "worker-b"],
      requiredCapabilities: [],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: [],
      status: "pending",
    },
    {
      id: "verify",
      kind: "verification",
      title: "Verify",
      objective: "Verify the joined report",
      dependencies: ["join"],
      requiredCapabilities: [],
      resourceScopes: [],
      expectedArtifacts: [],
      successCriteria: ["report is supported by evidence"],
      status: "pending",
    },
  ],
  edges: [
    { from: "worker-a", to: "join", when: "success" },
    { from: "worker-b", to: "join", when: "success" },
    { from: "join", to: "verify", when: "success" },
  ],
  status: "ready",
  requiresConfirmation: false,
  createdAt: 1,
  updatedAt: 1,
};

describe("runOrchestratedAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrchestrationStore.setState({
      current: {
        runId: "run-1",
        conversationId: "conversation-1",
        phase: "execution",
        brief,
        plan,
        assignments: [],
        events: [],
      },
      preparing: null,
    });
    vi.mocked(runAgentLoop).mockImplementation((options) => {
      const content = String(options.messages.at(-1)?.content);
      return Promise.resolve({
        turns: [
          {
            stream: { content, status: "complete" },
            ...(content.includes("Verify")
              ? {
                  toolResults: [
                    {
                      toolCallId: "verify-1",
                      toolName: "git_status",
                      success: true,
                      output: "clean",
                    },
                  ],
                }
              : {}),
          },
        ],
        maxIterationsReached: false,
        messages: options.messages,
        agentRun: options.runtime.agentRun!,
      });
    });
  });

  it("dispatches independent workers, validates reports, and joins their results", async () => {
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability) => capability === "chat",
      toolRegistry: createToolRegistry(),
    } satisfies EvirRuntime;
    const result = await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: brief.objective }],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    const current = useOrchestrationStore.getState().current;
    expect(current?.plan?.status).toBe("completed");
    expect(current?.assignments).toHaveLength(2);
    expect(current?.assignments.every(({ status }) => status === "completed")).toBe(true);
    expect(current?.events.filter(({ type }) => type === "agent.spawned")).toHaveLength(2);
    expect(vi.mocked(runAgentLoop)).toHaveBeenCalledTimes(3);
    expect(result.turns.filter(({ stream }) => stream.content.trim())).toHaveLength(1);
    expect(result.turns.at(-1)?.stream.content).toContain("Verify");
  });

  it("keeps recent dialogue context when a follow-up task references the previous result", async () => {
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability) => capability === "chat",
      toolRegistry: createToolRegistry(),
    } satisfies EvirRuntime;

    await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [
        { role: "user", content: "Read verify.sh" },
        { role: "assistant", content: "The script expects alpha, beta, gamma." },
        { role: "user", content: "Does input.txt satisfy it?" },
      ],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    expect(vi.mocked(runAgentLoop).mock.calls[0]?.[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "The script expects alpha, beta, gamma.",
        }),
      ]),
    );
  });

  it("preserves a worker approval even when another parallel worker finishes later", async () => {
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability) => capability === "chat",
      toolRegistry: createToolRegistry(),
    } satisfies EvirRuntime;
    vi.mocked(runAgentLoop).mockImplementation(async (options) => {
      const content = String(options.messages.at(-1)?.content);
      if (content.includes("Worker A")) {
        return {
          turns: [
            {
              stream: { content: "Approval needed", status: "complete" },
              pendingApproval: {
                toolCallId: "call-a",
                toolName: "write_file",
                args: { path: "/a" },
              },
            },
          ],
          maxIterationsReached: false,
          messages: options.messages,
          agentRun: options.runtime.agentRun!,
        };
      }
      await Promise.resolve();
      return {
        turns: [{ stream: { content: "Worker B done", status: "complete" } }],
        maxIterationsReached: false,
        messages: options.messages,
        agentRun: options.runtime.agentRun!,
      };
    });

    const result = await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: brief.objective }],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    expect(result.approvalContexts).toHaveLength(1);
    expect(result.approvalContexts?.[0]?.nodeId).toBe("worker-a");
    expect(useOrchestrationStore.getState().current?.plan?.status).toBe("paused");
  });

  it("does not auto-complete a plan approval node without user confirmation", async () => {
    const approvalPlan: PlanGraph = {
      ...plan,
      nodes: [
        {
          id: "approve",
          kind: "approval",
          title: "Approve",
          objective: "Confirm execution",
          dependencies: [],
          requiredCapabilities: [],
          resourceScopes: [],
          expectedArtifacts: [],
          successCriteria: [],
          status: "ready",
        },
      ],
      edges: [],
      status: "ready",
    };
    useOrchestrationStore.setState({
      current: {
        runId: brief.runId,
        conversationId: brief.conversationId,
        phase: "execution",
        brief: { ...brief, goalKind: "answer" },
        plan: approvalPlan,
        assignments: [],
        events: [],
      },
    });
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability) => capability === "chat",
      toolRegistry: createToolRegistry(),
    } satisfies EvirRuntime;

    await runOrchestratedAgent({
      provider,
      conversationId: brief.conversationId,
      messages: [{ role: "user", content: "Do it" }],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    expect(useOrchestrationStore.getState().current?.plan?.status).toBe("paused");
    expect(vi.mocked(runAgentLoop)).not.toHaveBeenCalled();
  });
});
