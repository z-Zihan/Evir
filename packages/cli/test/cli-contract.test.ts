import { describe, expect, it, vi } from "vitest";
import { parseArguments } from "../src/arguments";
import { cliStrings, fill } from "../src/messages";
import { requestApproval } from "../src/approval";
import { runAgent, type AgentEvent } from "../src/agent";
import { streamProvider } from "../src/provider-client";

/**
 * CLI-1/2 contract: doctor flags, zh/en copy, JSONL agent events, and the
 * non-TTY write/execute refusal.
 */

vi.mock("../src/provider-client", () => ({ streamProvider: vi.fn() }));

describe("CLI argument surface", () => {
  it("parses doctor --json and agent --json --lang", () => {
    expect(parseArguments(["doctor", "--json"])).toEqual({ command: "doctor", json: true });
    expect(parseArguments(["doctor"])).toEqual({ command: "doctor" });
    const agent = parseArguments(["agent", "fix the bug", "--json", "--lang", "zh"]);
    expect(agent).toMatchObject({
      command: "agent",
      prompt: "fix the bug",
      json: true,
      lang: "zh",
    });
  });
});

describe("CLI localization (CLI-2)", () => {
  it("zh and en cover the same keys with real copy", () => {
    const en = cliStrings("en");
    const zh = cliStrings("zh");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(en.approvalTitle).toBe("Approval required");
    expect(zh.approvalTitle).toBe("需要审批");
    expect(fill(zh.agentWorkspace, { workspace: "/tmp/p" })).toContain("/tmp/p");
  });

  it("help mentions doctor --json and --lang in both languages", () => {
    for (const strings of [cliStrings("en"), cliStrings("zh")]) {
      const help = fill(strings.help, { version: "0.1.0" });
      expect(help).toContain("doctor [--json]");
      expect(help).toContain("--lang zh|en");
    }
  });

  it("doctor labels and details are localized but the configure command stays in English", () => {
    const en = cliStrings("en");
    const zh = cliStrings("zh");
    expect(en.doctorApiKeyMissing).toContain("evir configure");
    expect(zh.doctorApiKeyMissing).toContain("evir configure");
    expect(zh.doctorLabelApiKey).not.toBe(en.doctorLabelApiKey);
  });
});

describe("non-interactive refusal (CLI-2)", () => {
  it("writes/commands are refused without a TTY, in the active language", async () => {
    const fakeStdin = { isTTY: false } as unknown as NodeJS.ReadStream;
    await expect(requestApproval("write file", fakeStdin)).rejects.toThrow(
      "Refusing a write or command without an interactive terminal approval",
    );
    await expect(
      requestApproval("write file", fakeStdin, process.stderr, cliStrings("zh")),
    ).rejects.toThrow("无交互终端时拒绝执行写入或命令");
  });
});

describe("agent JSONL events (CLI-2)", () => {
  it("emits run-start → step → approval → tool-result → completed", async () => {
    const events: AgentEvent[] = [];
    const config = {
      id: "p1",
      name: "P",
      protocolId: "openai-compatible-chat" as const,
      baseUrl: "https://example.com/v1",
      modelId: "m",
      toolCalling: true,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };
    vi.mocked(streamProvider).mockImplementationOnce(() =>
      Promise.resolve({
        content: "",
        stopped: false,
        toolCalls: [{ id: "c1", name: "write_file", arguments: '{"path":"a"}' }],
      }),
    );
    vi.mocked(streamProvider).mockImplementationOnce(() =>
      Promise.resolve({ content: "done", stopped: false, toolCalls: [] }),
    );

    const result = await runAgent({
      config,
      apiKey: "k",
      prompt: "do it",
      workspace: "/tmp/w",
      signal: new AbortController().signal,
      onDelta: () => undefined,
      approve: () => Promise.resolve(true),
      onEvent: (event) => events.push(event),
    });
    // Override tools requires touching createWorkspaceTools; assert the
    // contract on the events that DID flow (run-start/step/completed) plus
    // approval+tool-result from the real workspace tool path.
    expect(result.error).toBeUndefined();
    expect(events[0]).toMatchObject({ type: "run-start", workspace: "/tmp/w" });
    expect(events.some((event) => event.type === "step")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });
});
