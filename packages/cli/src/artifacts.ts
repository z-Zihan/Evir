import { mkdir, writeFile } from "node:fs/promises";
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

function degradedSummary(bytes: number, headPreview: string, reason: string): string {
  return [
    `Tool output was ${bytes} bytes, over the 256KB limit, but it could not be written to an artifact file (${reason}).`,
    "First 4KB of the output follows (remainder truncated and unavailable):",
    headPreview,
    "[... output truncated, artifact write failed ...]",
  ].join("\n\n");
}
