import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import type { ProviderClient, ProviderTurn } from "../src/provider-client";
import type { ExtensionTool } from "../src/workspace-tools";

const config = {
  protocolId: "openai-compatible-chat" as const,
  baseUrl: "https://example.com/v1",
  modelId: "tool-model",
  toolCalling: true,
};

function turn(values: Partial<ProviderTurn>): ProviderTurn {
  return {
    content: "",
    toolCalls: [],
    completed: true,
    stopped: false,
    ...values,
  };
}

function fixture(approved: boolean) {
  const execute = vi.fn(() => Promise.resolve("Wrote file"));
  const tools: ExtensionTool[] = [
    {
      name: "write_file",
      description: "Write",
      parameters: { type: "object" },
      risk: "write",
      execute,
    },
    {
      name: "git_status",
      description: "Status",
      parameters: { type: "object" },
      risk: "read",
      execute: vi.fn(() => Promise.resolve(" M src/example.ts")),
    },
  ];
  const turns = [
    turn({
      toolCalls: [
        {
          id: "call-1",
          name: "write_file",
          arguments: JSON.stringify({ path: "src/example.ts", content: "export {};" }),
        },
      ],
    }),
    turn({ content: "Done" }),
  ];
  const receivedMessages: unknown[][] = [];
  const stream: ProviderClient["stream"] = vi.fn(
    (...args: Parameters<ProviderClient["stream"]>) => {
      const messages = args[2];
      const onDelta = args[5];
      receivedMessages.push(messages);
      const next = turns.shift() ?? turn({ content: "Done" });
      if (next.content) onDelta(next.content);
      return Promise.resolve(next);
    },
  );
  const runner = new AgentRunner({ stream }, { list: () => tools });
  return {
    runner,
    execute,
    receivedMessages,
    requestApproval: vi.fn(() => Promise.resolve(approved)),
  };
}

describe("AgentRunner", () => {
  it("never executes a write when the user denies approval", async () => {
    const test = fixture(false);
    const result = await test.runner.run({
      config,
      apiKey: "key",
      history: [{ role: "user", content: "Change the file" }],
      workspaceNames: ["project"],
      signal: new AbortController().signal,
      onDelta: () => undefined,
      requestApproval: test.requestApproval,
    });

    expect(test.requestApproval).toHaveBeenCalledOnce();
    expect(test.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(test.receivedMessages[1])).toContain("User denied this tool call");
    expect(result.content).toBe("Done");
  });

  it("records deterministic evidence after an approved workspace write", async () => {
    const test = fixture(true);
    const result = await test.runner.run({
      config,
      apiKey: "key",
      history: [{ role: "user", content: "Change the file" }],
      workspaceNames: ["project"],
      signal: new AbortController().signal,
      onDelta: () => undefined,
      requestApproval: test.requestApproval,
    });

    expect(test.execute).toHaveBeenCalledOnce();
    expect(result.content).toContain("Verification evidence");
    expect(result.content).toContain("M src/example.ts");
  });
});

// VS-1: the activity timeline events.
describe("AgentRunner activity events (VS-1)", () => {
  function activityHarness(options?: { approve?: boolean; fail?: boolean }) {
    const events: import("../src/agent-runner").AgentActivityEvent[] = [];
    const tools: ExtensionTool[] = [
      {
        name: "write_file",
        description: "Write",
        parameters: { type: "object" },
        risk: "write",
        execute: async () => {
          if (options?.fail) throw new Error("disk full");
          return "Wrote file";
        },
      },
      {
        name: "git_status",
        description: "Status",
        parameters: { type: "object" },
        risk: "read",
        execute: vi.fn(() => Promise.resolve(" M src/example.ts")),
      },
    ];
    const turns = [
      turn({
        toolCalls: [
          {
            id: "call-1",
            name: "write_file",
            arguments: JSON.stringify({ path: "src/example.ts", content: "export {};" }),
          },
        ],
      }),
      turn({ content: "Done" }),
    ];
    const stream: ProviderClient["stream"] = vi.fn(
      (...args: Parameters<ProviderClient["stream"]>) => {
        const next = turns.shift() ?? turn({ content: "Done" });
        return Promise.resolve(next);
      },
    );
    const runner = new AgentRunner({ stream }, { list: () => tools });
    return {
      events,
      run: runner.run({
        config,
        apiKey: "k",
        history: [{ role: "user", content: "go" }],
        workspaceNames: ["w"],
        signal: new AbortController().signal,
        onDelta: () => undefined,
        requestApproval: async () => options?.approve ?? true,
        onEvent: (event) => events.push(event),
      }),
    };
  }

  it("emits started → waiting → resolved → completed for an approved write", async () => {
    const { events, run } = activityHarness({ approve: true });
    const result = await run;
    expect(result.error).toBeUndefined();
    expect(events.map((event) => event.kind)).toEqual([
      "tool-started",
      "approval-waiting",
      "approval-resolved",
      "tool-completed",
      "verification",
    ]);
    expect(events[0]).toMatchObject({ tool: "write_file", risk: "write" });
    expect(events[2]).toMatchObject({ approved: true });
  });

  it("emits denied without executing, and tool-failed with the reason", async () => {
    const denied = activityHarness({ approve: false });
    await denied.run;
    expect(denied.events.map((event) => event.kind)).toEqual([
      "tool-started",
      "approval-waiting",
      "approval-resolved",
    ]);
    expect(denied.events[2]).toMatchObject({ approved: false });

    const failing = activityHarness({ approve: true, fail: true });
    await failing.run;
    const failure = failing.events.find((event) => event.kind === "tool-failed");
    expect(failure).toMatchObject({ tool: "write_file" });
    if (failure?.kind === "tool-failed") expect(failure.reason).toContain("disk full");
  });
});
