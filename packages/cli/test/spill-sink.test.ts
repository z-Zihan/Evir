import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpillSink } from "../src/artifacts";

/**
 * docs/20 §9: run_command/git_* stream their output through createSpillSink
 * instead of building one finished string, so a >256KB process output never
 * grows unbounded in memory before it reaches artifacts.ts's spill logic.
 * See packages/cli/src/artifacts.ts and workspace-tools.ts's runProcess.
 */

const SPILL_THRESHOLD_BYTES = 256 * 1024;

let appendFileFailAfter: number | null = null;
let appendFileCalls = 0;

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      appendFileCalls += 1;
      if (appendFileFailAfter !== null && appendFileCalls > appendFileFailAfter) {
        throw new Error("simulated appendFile failure");
      }
      return actual.appendFile(...args);
    },
  };
});

const temporaryDirectories: string[] = [];
beforeEach(() => {
  appendFileFailAfter = null;
  appendFileCalls = 0;
});
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function makeRoot(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "evir-cli-spill-sink-"));
  temporaryDirectories.push(created);
  return created;
}

describe("createSpillSink within threshold", () => {
  it("returns the concatenated input unchanged when total stays within the threshold", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "run_command");
    sink.append(Buffer.from("a".repeat(1000)));
    sink.append(Buffer.from("b".repeat(2000)));
    const result = await sink.finish();
    expect(result.artifact).toBeUndefined();
    expect(result.content).toBe("a".repeat(1000) + "b".repeat(2000));
  });

  it("does not spill at exactly SPILL_THRESHOLD_BYTES total", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "run_command");
    sink.append(Buffer.from("x".repeat(SPILL_THRESHOLD_BYTES)));
    const result = await sink.finish();
    expect(result.artifact).toBeUndefined();
    expect(result.content).toBe("x".repeat(SPILL_THRESHOLD_BYTES));
  });

  it("decodes a multi-byte UTF-8 character split across a chunk boundary correctly", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "run_command");
    // "€" is E2 82 AC in UTF-8; split it across two chunks.
    const encoded = Buffer.from("price: €1", "utf8");
    const splitPoint = encoded.indexOf(0x82); // middle byte of the euro sign
    sink.append(encoded.subarray(0, splitPoint));
    sink.append(encoded.subarray(splitPoint));
    const result = await sink.finish();
    expect(result.artifact).toBeUndefined();
    expect(result.content).toBe("price: €1");
  });
});

describe("createSpillSink spill boundary", () => {
  it("spills once total crosses SPILL_THRESHOLD_BYTES by 1 byte", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "run_command");
    sink.append(Buffer.from("y".repeat(SPILL_THRESHOLD_BYTES + 1)));
    const result = await sink.finish();
    expect(result.artifact).toBeDefined();
    expect(result.artifact?.bytes).toBe(SPILL_THRESHOLD_BYTES + 1);
  });

  it("writes every chunk byte-for-byte to the artifact file across many chunks", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "git_diff");
    const chunks: Buffer[] = [];
    for (let i = 0; i < 300; i += 1) {
      const chunk = Buffer.from(`chunk-${i}-`.padEnd(1200, "z"));
      chunks.push(chunk);
      sink.append(chunk);
    }
    const result = await sink.finish();
    const artifact = result.artifact;
    if (!artifact) throw new Error("expected an artifact");
    const expected = Buffer.concat(chunks);
    expect(artifact.bytes).toBe(expected.byteLength);
    const written = await readFile(path.join(root, artifact.path));
    expect(Buffer.compare(written, expected)).toBe(0);
  });

  it("includes a 4KB preview of the head of the output in the summary", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "run_command");
    const marker = "PREVIEW_MARKER_AT_START";
    const head = marker + "a".repeat(4 * 1024 - marker.length - 1);
    const beyondPreview = "UNSEEN_BEYOND_4KB_WINDOW";
    sink.append(Buffer.from(head));
    sink.append(Buffer.from("b".repeat(SPILL_THRESHOLD_BYTES)));
    sink.append(Buffer.from(beyondPreview));
    const result = await sink.finish();
    expect(result.content).toContain(marker);
    expect(result.content).not.toContain(beyondPreview);
  });
});

describe("createSpillSink partial writes", () => {
  it("reports a partial artifact when a later appendFile call fails", async () => {
    const root = await makeRoot();
    const sink = createSpillSink(root, "run_command");
    const firstBytes = SPILL_THRESHOLD_BYTES - 100;
    const crossing = 200; // combined with firstBytes, crosses the threshold and triggers the initial writeFile
    const afterSpill = 50; // appended post-spill, via appendFile, which we fail below

    sink.append(Buffer.from("p".repeat(firstBytes)));
    appendFileFailAfter = 0; // fail every appendFile call from here on
    sink.append(Buffer.from("q".repeat(crossing)));
    sink.append(Buffer.from("r".repeat(afterSpill)));

    const result = await sink.finish();
    const artifact = result.artifact;
    if (!artifact) throw new Error("expected an artifact");
    expect(artifact.bytes).toBe(firstBytes + crossing);
    expect(result.content).toContain(String(firstBytes + crossing));
    expect(result.content.toLowerCase()).toContain("incomplete");

    const written = await readFile(path.join(root, artifact.path));
    expect(written.byteLength).toBe(firstBytes + crossing);
    expect(written.toString("utf8")).not.toContain("r");
  });
});

describe("createSpillSink degraded writes", () => {
  it("degrades to a preview without throwing when the artifact directory cannot be created", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, ".evir"), "not a directory");
    const sink = createSpillSink(root, "run_command");
    sink.append(Buffer.from("w".repeat(SPILL_THRESHOLD_BYTES + 1)));
    const result = await sink.finish();
    expect(result.artifact).toBeUndefined();
    expect(result.content).toContain(String(SPILL_THRESHOLD_BYTES + 1));
    expect(result.content.toLowerCase()).toContain("could not be written");
  });
});
