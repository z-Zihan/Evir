import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spillIfTooLarge } from "../src/artifacts";
import { createWorkspaceTools, type CliTool } from "../src/workspace-tools";
import { resolveWorkspace } from "../src/workspace-boundary";
import { runAgent } from "../src/agent";
import { streamProvider } from "../src/provider-client";

/**
 * docs/20 §9: tool output over 256KB spills to `.evir/artifacts/` and
 * returns a summary; `read_file` over the same limit still throws (no
 * spill). See packages/cli/src/artifacts.ts.
 */

const SPILL_THRESHOLD_BYTES = 256 * 1024;

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function makeRoot(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "evir-cli-artifacts-"));
  temporaryDirectories.push(created);
  return created;
}

describe("spillIfTooLarge boundary", () => {
  it("does not spill at exactly 256*1024 bytes", async () => {
    const root = await makeRoot();
    const output = "a".repeat(SPILL_THRESHOLD_BYTES);
    const result = await spillIfTooLarge(root, "run_command", output);
    expect(result.artifact).toBeUndefined();
    expect(result.content).toBe(output);
  });

  it("spills at 256*1024 + 1 bytes", async () => {
    const root = await makeRoot();
    const output = "a".repeat(SPILL_THRESHOLD_BYTES + 1);
    const result = await spillIfTooLarge(root, "run_command", output);
    expect(result.artifact).toBeDefined();
    expect(result.artifact?.bytes).toBe(SPILL_THRESHOLD_BYTES + 1);
  });
});

describe("spillIfTooLarge artifact file", () => {
  it("writes the full output byte-for-byte to the artifact file", async () => {
    const root = await makeRoot();
    const output = "x".repeat(SPILL_THRESHOLD_BYTES + 12345);
    const result = await spillIfTooLarge(root, "search_files", output);
    const artifact = result.artifact;
    if (!artifact) throw new Error("expected an artifact");
    const written = await readFile(path.join(root, artifact.path));
    expect(Buffer.compare(written, Buffer.from(output, "utf8"))).toBe(0);
    expect(written.byteLength).toBe(artifact.bytes);
  });

  it("summary content carries the artifact relative path, byte count, and a truncated marker", async () => {
    const root = await makeRoot();
    const output = "y".repeat(SPILL_THRESHOLD_BYTES + 500);
    const result = await spillIfTooLarge(root, "list_directory", output);
    const artifact = result.artifact;
    if (!artifact) throw new Error("expected an artifact");
    expect(result.content).toContain(artifact.path);
    expect(result.content).toContain(String(SPILL_THRESHOLD_BYTES + 500));
    expect(result.content.toLowerCase()).toContain("truncated");
    expect(result.content.length).toBeLessThan(SPILL_THRESHOLD_BYTES);
  });

  it("filename is under .evir/artifacts/ and encodes a UTC timestamp, the pid, and the tool name", async () => {
    const root = await makeRoot();
    const output = "z".repeat(SPILL_THRESHOLD_BYTES + 1);
    const result = await spillIfTooLarge(root, "git_diff", output);
    const artifact = result.artifact;
    if (!artifact) throw new Error("expected an artifact");
    const normalized = artifact.path.split(path.sep).join("/");
    expect(normalized.startsWith(".evir/artifacts/")).toBe(true);
    const filename = path.basename(artifact.path);
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/);
    expect(filename).toContain(String(process.pid));
    expect(filename).toContain("git_diff");
    expect(filename.endsWith(".txt")).toBe(true);
  });
});

describe("spillIfTooLarge write failure", () => {
  it("degrades to a preview without throwing when the artifact directory cannot be created", async () => {
    const root = await makeRoot();
    // Make `.evir` a plain file so `mkdir('.evir/artifacts', {recursive:true})`
    // fails with ENOTDIR instead of succeeding.
    await writeFile(path.join(root, ".evir"), "not a directory");
    const output = "w".repeat(SPILL_THRESHOLD_BYTES + 1);
    const result = await spillIfTooLarge(root, "run_command", output);
    expect(result.artifact).toBeUndefined();
    expect(result.content).toContain(String(SPILL_THRESHOLD_BYTES + 1));
    expect(result.content.toLowerCase()).toContain("could not be written");
    expect(result.content.length).toBeLessThan(SPILL_THRESHOLD_BYTES);
  });
});

describe("search_files skips .evir", () => {
  it("does not return matches living under .evir/artifacts", async () => {
    const root = await makeRoot();
    await spillIfTooLarge(root, "run_command", "q".repeat(SPILL_THRESHOLD_BYTES + 1));
    await writeFile(path.join(root, "unique-marker-visible.txt"), "visible");
    const tools = createWorkspaceTools(root);
    const search = tools.find((candidate) => candidate.name === "search_files");
    if (!search) throw new Error("search_files tool missing");
    const matches = await search.execute(
      { pattern: "unique-marker" },
      new AbortController().signal,
    );
    expect(matches).toContain("unique-marker-visible.txt");
    const artifactMatches = await search.execute({ pattern: "evir" }, new AbortController().signal);
    expect(artifactMatches).not.toContain(".evir");
  });
});

vi.mock("../src/provider-client", () => ({ streamProvider: vi.fn() }));
vi.mock("../src/workspace-tools", async () => {
  const actual = await vi.importActual<typeof import("../src/workspace-tools")>(
    "../src/workspace-tools",
  );
  const bigOutputTool: CliTool = {
    name: "big_output_tool",
    description: "Test fixture: returns output over the spill threshold.",
    risk: "read",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    preview: () => "big_output_tool",
    execute: async () => "b".repeat(SPILL_THRESHOLD_BYTES + 1000),
  };
  return {
    ...actual,
    createWorkspaceTools: (root: string) => [...actual.createWorkspaceTools(root), bigOutputTool],
  };
});

describe("agent integration: tool output spill", () => {
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

  async function makeGitWorkspace(): Promise<string> {
    const created = await mkdtemp(path.join(os.tmpdir(), "evir-cli-artifact-agent-"));
    temporaryDirectories.push(created);
    const root = await resolveWorkspace(created);
    spawnSync("git", ["init", "-q"], { cwd: root });
    return root;
  }

  it(
    "replaces a >256KB tool output with a summary and reports the artifact on the tool-result event",
    async () => {
      const workspace = await makeGitWorkspace();

      vi.mocked(streamProvider).mockReset();
      vi.mocked(streamProvider).mockImplementationOnce(() =>
        Promise.resolve({
          content: "",
          stopped: false,
          toolCalls: [{ id: "c1", name: "big_output_tool", arguments: "{}" }],
        }),
      );
      vi.mocked(streamProvider).mockImplementationOnce(() =>
        Promise.resolve({ content: "done", stopped: false, toolCalls: [] }),
      );

      const events: Array<{ type: string; [key: string]: unknown }> = [];
      const result = await runAgent({
        config,
        apiKey: "k",
        prompt: "do it",
        workspace,
        signal: new AbortController().signal,
        onDelta: () => undefined,
        approve: () => Promise.resolve(true),
        onEvent: (event) => events.push(event as unknown as { type: string }),
      });

      expect(result.error).toBeUndefined();
      const toolResult = events.find(
        (event) => event.type === "tool-result" && event.tool === "big_output_tool",
      );
      if (!toolResult) throw new Error("no tool-result event for big_output_tool");
      expect(toolResult.ok).toBe(true);
      const artifact = toolResult.artifact as { path: string; bytes: number } | undefined;
      if (!artifact) throw new Error("expected an artifact field on the tool-result event");
      expect(artifact.bytes).toBe(SPILL_THRESHOLD_BYTES + 1000);

      const secondCall = vi.mocked(streamProvider).mock.calls[1]?.[0] as
        | { messages: Array<{ role: string; content: string }> }
        | undefined;
      if (!secondCall) throw new Error("streamProvider was not called a second time");
      const toolMessage = secondCall.messages.find((message) => message.role === "tool");
      if (!toolMessage) throw new Error("no tool message in the second turn");
      expect(toolMessage.content.length).toBeLessThan(SPILL_THRESHOLD_BYTES);
      expect(toolMessage.content).toContain(artifact.path);

      const onDisk = await stat(path.join(workspace, artifact.path));
      expect(onDisk.size).toBe(SPILL_THRESHOLD_BYTES + 1000);
    },
  );
});
