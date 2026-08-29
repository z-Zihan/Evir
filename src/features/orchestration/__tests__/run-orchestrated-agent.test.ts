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
      has: (capability: string) => capability === "chat",
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

  it("fails a verification node whose summary states the evidence did not support completion", async () => {
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability: string) => capability === "chat",
      toolRegistry: createToolRegistry(),
    } satisfies EvirRuntime;
    vi.mocked(runAgentLoop).mockImplementation((options) => {
      const content = String(options.messages.at(-1)?.content);
      const isVerify = content.includes("Collect deterministic completion evidence");
      return Promise.resolve({
        turns: [
          {
            stream: {
              content: isVerify
                ? "Verification Result: **FAILED** — task was not completed, nothing was written."
                : "Done inspecting",
              status: "complete",
            },
          },
        ],
        maxIterationsReached: false,
        messages: options.messages,
        agentRun: options.runtime.agentRun!,
      });
    });

    await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: brief.objective }],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    const current = useOrchestrationStore.getState().current;
    // A verification that ran but concluded FAILED must not complete the run.
    const terminal = current?.events.filter(({ type }) => type.startsWith("run."));
    expect(terminal?.some(({ type }) => type === "run.completed")).toBeFalsy();
    expect(current?.plan?.status).not.toBe("completed");
  });

  it("completes a node that exhausts its iteration budget with tool evidence instead of failing it", async () => {
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability: string) => capability === "chat",
      toolRegistry: createToolRegistry(),
    } satisfies EvirRuntime;
    vi.mocked(runAgentLoop).mockImplementation((options) =>
      Promise.resolve({
        turns: [
          {
            stream: { content: "", status: "complete" },
            toolResults: [
              {
                toolCallId: "call-1",
                toolName: "read_file",
                success: true,
                output: "fixture evidence",
              },
            ],
          },
        ],
        maxIterationsReached: true,
        messages: options.messages,
        agentRun: options.runtime.agentRun!,
      }),
    );

    const result = await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: brief.objective }],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    const current = useOrchestrationStore.getState().current;
    expect(current?.events.some(({ type }) => type === "node.failed")).toBe(false);
    expect(current?.plan?.status).toBe("completed");
    expect(
      current?.events.some(
        (event) =>
          event.type === "agent.completed" &&
          event.summary.includes("Iteration budget reached before a final summary"),
      ),
    ).toBe(true);
  });

  it("keeps recent dialogue context when a follow-up task references the previous result", async () => {
    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability: string) => capability === "chat",
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
      has: (capability: string) => capability === "chat",
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
      has: (capability: string) => capability === "chat",
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

describe("goal done-when verification", () => {
  const doneWhenBrief: TaskBrief = {
    ...brief,
    goalKind: "change",
    doneWhen: ["pnpm check PASS", "Code Review 无 P0"],
  };

  function runtimeWithCommand(success: boolean): EvirRuntime {
    return {
      target: "desktop",
      capabilities: new Set(["chat"]),
      has: (capability: string) => capability === "chat",
      toolRegistry: createToolRegistry(),
      getWorkspaceRoot: () => "/project",
      storage: {},
      toolExecutor: {
        execute: vi.fn(() =>
          Promise.resolve({
            success,
            output: success ? "" : "type errors",
          }),
        ),
      } as unknown as NonNullable<EvirRuntime["toolExecutor"]>,
      permissionContext: { profile: "full", roots: ["/project"] },
      mode: "goal",
    } as unknown as EvirRuntime;
  }

  it("completes the goal only when every executable criterion actually passes", async () => {
    useOrchestrationStore.setState({
      current: {
        runId: "run-1",
        conversationId: "conversation-1",
        phase: "execution",
        brief: doneWhenBrief,
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
                    { toolCallId: "v", toolName: "git_status", success: true, output: "ok" },
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

    await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: doneWhenBrief.objective }],
      runtime: runtimeWithCommand(true),
      privateSession: true,
      onDelta: vi.fn(),
    });

    const current = useOrchestrationStore.getState().current;
    expect(current?.plan?.status).toBe("completed");
    expect(current?.brief.doneWhenResults?.[0]).toMatchObject({ status: "passed" });
    expect(current?.brief.doneWhenResults?.[1]).toMatchObject({ status: "manual" });
    expect(current?.events.filter(({ type }) => type === "goal.verification.passed")).toHaveLength(
      1,
    );
  });

  it("fails the goal when a done-when command fails, even with all steps completed", async () => {
    useOrchestrationStore.setState({
      current: {
        runId: "run-1",
        conversationId: "conversation-1",
        phase: "execution",
        brief: doneWhenBrief,
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
                    { toolCallId: "v", toolName: "git_status", success: true, output: "ok" },
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

    await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: doneWhenBrief.objective }],
      runtime: runtimeWithCommand(false),
      privateSession: true,
      onDelta: vi.fn(),
    });

    const current = useOrchestrationStore.getState().current;
    // Steps all completed, but the done-when command failed -> goal not complete.
    expect(current?.plan?.status).toBe("failed");
    expect(current?.brief.doneWhenResults?.[0]).toMatchObject({ status: "failed" });
    expect(current?.events.filter(({ type }) => type === "goal.verification.failed")).toHaveLength(
      1,
    );
  });
});

describe("sub-agent security ceiling", () => {
  it("verification nodes may run commands; read-only nodes stay on the plan profile", async () => {
    const verificationPlan: PlanGraph = {
      ...plan,
      nodes: [
        {
          id: "inspect",
          kind: "task",
          title: "Inspect files",
          objective: "List the files",
          dependencies: [],
          requiredCapabilities: ["filesystem"],
          resourceScopes: [],
          expectedArtifacts: [],
          successCriteria: [],
          status: "ready",
        },
        {
          id: "verify",
          kind: "verification",
          title: "Verify via ls",
          objective: "Run ls hello.txt and confirm status 0",
          dependencies: ["inspect"],
          requiredCapabilities: ["terminal"],
          resourceScopes: [],
          expectedArtifacts: [],
          successCriteria: ["ls hello.txt exits 0"],
          status: "pending",
        },
      ],
      edges: [{ from: "inspect", to: "verify", when: "success" }],
    };
    useOrchestrationStore.setState({
      current: {
        runId: "run-1",
        conversationId: "conversation-1",
        phase: "execution",
        brief,
        plan: verificationPlan,
        assignments: [],
        events: [],
      },
      preparing: null,
    });
    const registry = createToolRegistry();
    registry.register({
      id: "read_file",
      name: "read_file",
      description: "read",
      source: "evir-local",
      riskLevel: "L1",
      requiredCapability: "filesystem",
      schema: { type: "object" },
      execute: () => Promise.resolve({ success: true, output: "" }),
    });
    registry.register({
      id: "run_command",
      name: "run_command",
      description: "run a shell command",
      source: "evir-local",
      riskLevel: "L3",
      requiredCapability: "terminal",
      schema: { type: "object" },
      execute: () => Promise.resolve({ success: true, output: "hello.txt" }),
    });
    registry.register({
      id: "write_file",
      name: "write_file",
      description: "write",
      source: "evir-local",
      riskLevel: "L3",
      requiredCapability: "filesystem",
      schema: { type: "object" },
      execute: () => Promise.resolve({ success: true, output: "" }),
    });
    const observed: { mode: unknown; tools: string[] }[] = [];
    vi.mocked(runAgentLoop).mockImplementation((options) => {
      observed.push({
        mode: options.mode,
        tools: options.runtime.toolRegistry?.list().map(({ id }) => id) ?? [],
      });
      const content = String(options.messages.at(-1)?.content);
      const isVerification = content.includes("Verify");
      return Promise.resolve({
        turns: [
          {
            stream: { content, status: "complete" },
            ...(isVerification
              ? {
                  toolResults: [
                    {
                      toolCallId: "v",
                      toolName: "run_command",
                      success: true,
                      output: "hello.txt",
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

    const runtime = {
      target: "desktop",
      capabilities: new Set(["chat", "filesystem", "terminal"]),
      has: (capability: string) => ["chat", "filesystem", "terminal"].includes(capability),
      toolRegistry: registry,
    } satisfies EvirRuntime;
    await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: brief.objective }],
      runtime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    const current = useOrchestrationStore.getState().current;
    expect(current?.plan?.status).toBe("completed");
    const verifyLoop = observed.at(-1);
    expect(verifyLoop?.mode).toBe("agent");
    expect(verifyLoop?.tools).toContain("run_command");
    expect(verifyLoop?.tools).not.toContain("write_file");
    const inspectLoop = observed[0];
    expect(inspectLoop?.mode).toBe("plan");
    expect(inspectLoop?.tools).not.toContain("run_command");
    expect(inspectLoop?.tools).not.toContain("write_file");
  });

  it("workers inherit the parent permission context and never gain extra tools", async () => {
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
    const registry = createToolRegistry();
    registry.register({
      id: "write_file",
      name: "write_file",
      description: "write",
      source: "evir-local",
      riskLevel: "L3",
      schema: { type: "object" },
      execute: () => Promise.resolve({ success: true, output: "" }),
    });
    const parentContext = { profile: "workspace" as const, roots: ["/project"] };
    const seenContexts: unknown[] = [];
    const seenTools: string[][] = [];
    vi.mocked(runAgentLoop).mockImplementation((options) => {
      seenContexts.push(options.runtime.permissionContext);
      seenTools.push(options.runtime.toolRegistry?.list().map(({ id }) => id) ?? []);
      const content = String(options.messages.at(-1)?.content);
      return Promise.resolve({
        turns: [{ stream: { content, status: "complete" } }],
        maxIterationsReached: false,
        messages: options.messages,
        agentRun: options.runtime.agentRun!,
      });
    });

    await runOrchestratedAgent({
      provider,
      conversationId: "conversation-1",
      messages: [{ role: "user", content: brief.objective }],
      runtime: {
        target: "desktop",
        capabilities: new Set(["chat"]),
        has: (capability: string) => capability === "chat",
        toolRegistry: registry,
        permissionContext: parentContext,
      } as unknown as EvirRuntime,
      privateSession: true,
      onDelta: vi.fn(),
    });

    // Sub-agent nodes have no write scopes -> toolsForNode drops the L3 tool,
    // and the permission context is the parent's (never escalated).
    expect(seenTools.length).toBeGreaterThan(0);
    for (const tools of seenTools) expect(tools).not.toContain("write_file");
    for (const context of seenContexts) expect(context).toEqual(parentContext);
  });
});
