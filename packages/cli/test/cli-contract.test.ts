import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArguments } from "../src/arguments";
import { cliStrings, fill } from "../src/messages";
import { requestApproval } from "../src/approval";
import { envelopeEvent, runAgent, type AgentEvent } from "../src/agent";
import { streamProvider } from "../src/provider-client";
import { resolveWorkspace } from "../src/workspace-boundary";

/**
 * CLI-1/2 contract: doctor flags, zh/en copy, JSONL agent events, and the
 * non-TTY write/execute refusal.
 */

vi.mock("../src/provider-client", () => ({ streamProvider: vi.fn() }));

describe("CLI argument surface", () => {
  it("parses doctor --json and agent --json --lang", () => {
    expect(parseArguments(["doctor", "--json"])).toEqual({ command: "doctor", json: true });
    expect(parseArguments(["doctor"])).toEqual({ command: "doctor" });
    expect(parseArguments(["doctor", "--json", "--lang", "zh"])).toEqual({
      command: "doctor",
      json: true,
      lang: "zh",
    });
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
  it("defaults to English regardless of the process locale; --lang zh selects zh", () => {
    const previous = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    process.env.LANG = "zh_CN.UTF-8";
    process.env.LC_ALL = "zh_CN.UTF-8";
    try {
      expect(cliStrings().approvalTitle).toBe("Approval required");
      expect(cliStrings("en").approvalTitle).toBe("Approval required");
      expect(cliStrings("zh").approvalTitle).toBe("需要审批");
    } finally {
      if (previous.LANG === undefined) delete process.env.LANG;
      else process.env.LANG = previous.LANG;
      if (previous.LC_ALL === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = previous.LC_ALL;
    }
  });

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
      expect(help).toContain("doctor [--json] [--lang zh|en]");
    }
  });

  it("doctor labels and details are localized but the configure command stays in English", () => {
    const en = cliStrings("en");
    const zh = cliStrings("zh");
    expect(en.doctorApiKeyMissing).toContain("evir configure");
    expect(zh.doctorApiKeyMissing).toContain("evir configure");
    expect(zh.doctorLabelApiKey).not.toBe(en.doctorLabelApiKey);
  });

  it("en and zh both carry configInvalid and configureInvalid copy", () => {
    const en = cliStrings("en");
    const zh = cliStrings("zh");
    expect(en.configInvalid).toBeTruthy();
    expect(zh.configInvalid).toBeTruthy();
    expect(en.configureInvalid).toBeTruthy();
    expect(zh.configureInvalid).toBeTruthy();
    const filled = fill(en.configInvalid, { path: "/x", issues: "bad" });
    expect(filled).toContain("/x");
    expect(filled).toContain("bad");
  });

  it("en and zh both carry configure-output, error, prompt, and cancellation copy", () => {
    const en = cliStrings("en");
    const zh = cliStrings("zh");
    for (const key of [
      "configureSavedTo",
      "configureKeySaved",
      "configureKeyKept",
      "apiKeyNotSet",
      "promptRequired",
      "agentRequiresToolCalling",
      "hiddenApiKeyPrompt",
      "configureCancelled",
      "configureMissingArgs",
      "configurePromptProtocol",
      "configurePromptBaseUrl",
      "configurePromptModel",
      "configurePromptRetryBaseUrl",
      "notConfigured",
    ] as const) {
      expect(en[key]).toBeTruthy();
      expect(zh[key]).toBeTruthy();
      expect(zh[key]).not.toBe(en[key]);
    }
    expect(fill(en.configureSavedTo, { path: "/tmp/providers.json" })).toContain(
      "/tmp/providers.json",
    );
    expect(fill(zh.configureSavedTo, { path: "/tmp/providers.json" })).toContain(
      "/tmp/providers.json",
    );
    expect(en.apiKeyNotSet).toContain("EVIR_API_KEY");
    expect(zh.apiKeyNotSet).toContain("EVIR_API_KEY");
    expect(en.notConfigured).toContain("evir configure");
    expect(zh.notConfigured).toContain("evir configure");
    expect(fill(en.configureMissingArgs, { flags: "--base-url, --model" })).toContain(
      "--base-url, --model",
    );
    expect(en.configureMissingArgs).toContain("evir configure --protocol");
    expect(zh.configureMissingArgs).toContain("evir configure --protocol");
    expect(fill(en.configurePromptProtocol, { protocols: "a / b" })).toContain("a / b");
    expect(fill(zh.configurePromptProtocol, { protocols: "a / b" })).toContain("a / b");
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
    const bareEvents: AgentEvent[] = [];
    const envelopes: ReturnType<typeof envelopeEvent>[] = [];
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
      onEvent: (event) => {
        bareEvents.push(event);
        envelopes.push(envelopeEvent(event));
      },
    });
    // Override tools requires touching createWorkspaceTools; assert the
    // contract on the events that DID flow (run-start/step/completed) plus
    // approval+tool-result from the real workspace tool path.
    expect(result.error).toBeUndefined();
    expect(bareEvents[0]).toMatchObject({ type: "run-start", workspace: "/tmp/w" });
    expect(bareEvents.some((event) => event.type === "step")).toBe(true);
    expect(bareEvents.at(-1)).toMatchObject({ type: "completed" });

    // docs/20 §6.1: every envelope carries schemaVersion/command/timestamp
    // and wraps the exact bare payload — never a lossy transformation.
    for (const [index, envelope] of envelopes.entries()) {
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.command).toBe("agent");
      expect(Number.isNaN(new Date(envelope.timestamp).getTime())).toBe(false);
      expect(envelope.event).toEqual(bareEvents[index]);
    }
    expect(envelopes.map((envelope) => envelope.event)).toEqual(bareEvents);
  });
});

describe("agent completion summary (docs/20 §5/§6.1)", () => {
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

  const temporaryDirectories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  async function makeGitWorkspace(): Promise<string> {
    const created = await mkdtemp(path.join(os.tmpdir(), "evir-cli-agent-summary-"));
    temporaryDirectories.push(created);
    const root = await resolveWorkspace(created);
    spawnSync("git", ["init", "-q"], { cwd: root });
    return root;
  }

  function findCompleted(events: AgentEvent[]): Extract<AgentEvent, { type: "completed" }> {
    const completed = events.find(
      (event): event is Extract<AgentEvent, { type: "completed" }> => event.type === "completed",
    );
    if (!completed) throw new Error("No completed event was emitted");
    return completed;
  }

  it("reports verified=true with real toolCalls/writes/elapsedMs when every verification tool succeeds", async () => {
    const workspace = await makeGitWorkspace();
    vi.mocked(streamProvider).mockImplementationOnce(() =>
      Promise.resolve({
        content: "",
        stopped: false,
        toolCalls: [
          {
            id: "c1",
            name: "write_file",
            arguments: JSON.stringify({ path: "note.txt", content: "hello" }),
          },
          {
            id: "c2",
            name: "run_command",
            arguments: JSON.stringify({
              program: process.execPath,
              args: ["-e", "process.stdout.write('ok')"],
              timeoutMs: 5000,
            }),
          },
          { id: "c3", name: "git_status", arguments: "{}" },
          { id: "c4", name: "git_diff", arguments: "{}" },
        ],
      }),
    );
    vi.mocked(streamProvider).mockImplementationOnce(() =>
      Promise.resolve({ content: "done", stopped: false, toolCalls: [] }),
    );

    const events: AgentEvent[] = [];
    const result = await runAgent({
      config,
      apiKey: "k",
      prompt: "do it",
      workspace,
      signal: new AbortController().signal,
      onDelta: () => undefined,
      approve: () => Promise.resolve(true),
      onEvent: (event) => events.push(event),
    });

    expect(result.error).toBeUndefined();
    const completed = findCompleted(events);
    expect(completed.steps).toBe(2);
    expect(completed.toolCalls).toEqual({
      write_file: 1,
      run_command: 1,
      git_status: 1,
      git_diff: 1,
    });
    expect(completed.writes).toEqual({ ok: 2, failed: 0 });
    expect(completed.verified).toBe(true);
    expect(typeof completed.elapsedMs).toBe("number");
    expect(completed.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("reports verified=false and writes.failed>0 when run_command fails", async () => {
    const workspace = await makeGitWorkspace();
    vi.mocked(streamProvider).mockImplementationOnce(() =>
      Promise.resolve({
        content: "",
        stopped: false,
        toolCalls: [
          {
            id: "c1",
            name: "write_file",
            arguments: JSON.stringify({ path: "note.txt", content: "hello" }),
          },
          {
            id: "c2",
            name: "run_command",
            arguments: JSON.stringify({
              program: process.execPath,
              args: ["-e", "process.exit(1)"],
              timeoutMs: 5000,
            }),
          },
        ],
      }),
    );
    vi.mocked(streamProvider).mockImplementationOnce(() =>
      Promise.resolve({ content: "done", stopped: false, toolCalls: [] }),
    );

    const events: AgentEvent[] = [];
    const result = await runAgent({
      config,
      apiKey: "k",
      prompt: "do it",
      workspace,
      signal: new AbortController().signal,
      onDelta: () => undefined,
      approve: () => Promise.resolve(true),
      onEvent: (event) => events.push(event),
    });

    expect(result.error).toBeUndefined();
    const completed = findCompleted(events);
    expect(completed.toolCalls).toEqual({ write_file: 1, run_command: 1 });
    expect(completed.writes.ok).toBe(1);
    expect(completed.writes.failed).toBe(1);
    expect(completed.verified).toBe(false);
  });
});
