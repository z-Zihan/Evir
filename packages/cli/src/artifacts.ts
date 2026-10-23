import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * docs/20 §9: a single tool output over 256KB must spill to an artifact
 * file and return a summary instead of staying in Agent messages/terminal
 * memory. Kept independent from workspace-tools.ts's own MAX_BYTES (which
 * bounds run_command/git output capture) by design.
 */
const SPILL_THRESHOLD_BYTES = 256 * 1024;
const HEAD_PREVIEW_BYTES = 4 * 1024;

let spillCounter = 0;

export interface SpillResult {
  content: string;
  artifact?: { path: string; bytes: number };
}

export async function spillIfTooLarge(
  root: string,
  toolName: string,
  output: string,
): Promise<SpillResult> {
  const bytes = Buffer.byteLength(output);
  if (bytes <= SPILL_THRESHOLD_BYTES) return { content: output };

  const headPreview = Buffer.from(output).subarray(0, HEAD_PREVIEW_BYTES).toString("utf8");
  const relativePath = artifactRelativePath(toolName);
  const absolutePath = path.join(root, relativePath);

  try {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, output, "utf8");
    return {
      content: spilledSummary(bytes, headPreview, relativePath),
      artifact: { path: relativePath, bytes },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: degradedSummary(bytes, headPreview, reason) };
  }
}

export interface SpillSink {
  append(chunk: Buffer): void;
  finish(): Promise<SpillResult>;
}

/**
 * Streaming counterpart to spillIfTooLarge for sources (run_command/git_*)
 * that produce output incrementally instead of as one finished string.
 * Buffers in memory only up to SPILL_THRESHOLD_BYTES; once that's crossed it
 * writes the buffered content plus every later chunk straight to the
 * artifact file, so memory never grows past the threshold plus one chunk.
 */
export function createSpillSink(root: string, toolName: string): SpillSink {
  const bufferedChunks: Buffer[] = [];
  let totalBytes = 0;
  let spilled = false;
  let degraded = false;
  let partial = false;
  let degradedReason = "";
  let partialReason = "";
  let relativePath = "";
  let absolutePath = "";
  let headPreview = "";
  let diskBytesWritten = 0;
  let chain: Promise<void> = Promise.resolve();

  function append(chunk: Buffer): void {
    totalBytes += chunk.byteLength;
    if (degraded) return;

    if (!spilled) {
      bufferedChunks.push(chunk);
      if (totalBytes <= SPILL_THRESHOLD_BYTES) return;
      spilled = true;
      const combined = Buffer.concat(bufferedChunks);
      bufferedChunks.length = 0;
      headPreview = combined.subarray(0, HEAD_PREVIEW_BYTES).toString("utf8");
      relativePath = artifactRelativePath(toolName);
      absolutePath = path.join(root, relativePath);
      chain = chain.then(async () => {
        try {
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, combined);
          diskBytesWritten = combined.byteLength;
        } catch (error) {
          degraded = true;
          degradedReason = error instanceof Error ? error.message : String(error);
        }
      });
      return;
    }

    if (partial) return;
    chain = chain.then(async () => {
      if (degraded || partial) return;
      try {
        await appendFile(absolutePath, chunk);
        diskBytesWritten += chunk.byteLength;
      } catch (error) {
        partial = true;
        partialReason = error instanceof Error ? error.message : String(error);
      }
    });
  }

  async function finish(): Promise<SpillResult> {
    await chain;
    if (!spilled) return { content: Buffer.concat(bufferedChunks).toString("utf8") };
    if (degraded) return { content: degradedSummary(totalBytes, headPreview, degradedReason) };
    if (partial) {
      return {
        content: partialSummary(
          totalBytes,
          diskBytesWritten,
          headPreview,
          relativePath,
          partialReason,
        ),
        artifact: { path: relativePath, bytes: diskBytesWritten },
      };
    }
    return {
      content: spilledSummary(totalBytes, headPreview, relativePath),
      artifact: { path: relativePath, bytes: diskBytesWritten },
    };
  }

  return { append, finish };
}

function artifactRelativePath(toolName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  spillCounter += 1;
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(
    ".evir",
    "artifacts",
    `${timestamp}-${process.pid}-${spillCounter}-${safeTool}.txt`,
  );
}

function spilledSummary(bytes: number, headPreview: string, relativePath: string): string {
  return [
    `Tool output was ${bytes} bytes, over the 256KB limit, and was written in full to an artifact file under .evir/artifacts/ in the workspace: ${relativePath}`,
    "First 4KB of the output follows (remainder truncated):",
    headPreview,
    "[... output truncated, full content on disk ...]",
    `Use read_file on ${relativePath} to read the rest in segments.`,
  ].join("\n\n");
}

function partialSummary(
  totalBytes: number,
  diskBytes: number,
  headPreview: string,
  relativePath: string,
  reason: string,
): string {
  return [
    `Tool output exceeded the 256KB limit (${totalBytes} bytes seen) and started spilling to an artifact file under .evir/artifacts/ in the workspace: ${relativePath}`,
    `A later write to that file failed (${reason}), so only ${diskBytes} bytes made it to disk; the output is incomplete and the remainder is not available.`,
    "First 4KB of the output follows (remainder truncated):",
    headPreview,
    "[... output truncated, only a partial artifact is on disk ...]",
  ].join("\n\n");
}

function degradedSummary(bytes: number, headPreview: string, reason: string): string {
  return [
    `Tool output was ${bytes} bytes, over the 256KB limit, but it could not be written to an artifact file (${reason}).`,
    "First 4KB of the output follows (remainder truncated and unavailable):",
    headPreview,
    "[... output truncated, artifact write failed ...]",
  ].join("\n\n");
}
