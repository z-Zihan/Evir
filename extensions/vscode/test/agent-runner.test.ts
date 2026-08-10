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
