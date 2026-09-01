import { z } from "zod";
import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import type { SnapshotResult } from "../../runtime/desktop-storage-adapter";

/**
 * Task Outputs are derived from real tool executions and snapshot metadata —
 * never from the model claiming "I created report.pdf". A run's outputs are
 * recomputed deterministically from its persisted records so reopening a
 * thread shows the same set.
 */

export type TaskOutputKind = "created-file" | "screenshot";

export interface TaskOutput {
  /** Stable per-run identity: runId + source call/path. */
  id: string;
  runId: string;
  conversationId: string;
  kind: TaskOutputKind;
  /** Coarse artifact type label (html / pdf / svg / png / csv …). */
  type: string;
  path: string;
  mimeType?: string | undefined;
  sourceTool: string;
  createdAt: number;
}

export const taskOutputSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(["created-file", "screenshot"]),
  type: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().optional(),
  sourceTool: z.string().min(1),
  createdAt: z.number(),
});

/**
 * Extensions that mark a *final artifact* rather than project source code.
 * A newly created .jsx is a change (§16); a created .html/.pdf/.svg is an
 * output the user will want to open.
 */
const ARTIFACT_EXTENSIONS = new Set([
  "html",
  "htm",
  "svg",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "md",
  "markdown",
  "csv",
  "tsv",
  "txt",
  "mermaid",
  "mmd",
  "dot",
  "vega",
  "vl.json",
  "json",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  json: "application/json",
  mermaid: "text/x-mermaid",
  mmd: "text/x-mermaid",
  dot: "text/vnd.graphviz",
};

export function extensionOf(path: string): string {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  const name = normalized.split("/").pop() ?? "";
  if (name === "vl.json") return "vl.json";
  const dot = name.lastIndexOf(".");
  // Leading-dot files (".html") are dotfiles, not extension matches.
  return dot <= 0 ? "" : name.slice(dot + 1);
}

export function mimeTypeForPath(path: string): string | undefined {
  return MIME_BY_EXTENSION[extensionOf(path)];
}

/** Should a file the agent created count as a task output (vs. plain change)? */
export function isArtifactPath(path: string): boolean {
  return ARTIFACT_EXTENSIONS.has(extensionOf(path));
}

const screenshotOutputSchema = z.object({ path: z.string().min(1) });

function callArgumentString(call: ToolCallRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = call.arguments[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Derive outputs from one tool execution. Returns nothing for modified
 * source files, failed calls, or non-artifact creations — those belong to
 * the Changes panel instead.
 */
export function deriveTaskOutput(
  call: ToolCallRecord,
  result: ToolResultRecord,
  context: { runId: string; conversationId: string; newSnapshots: readonly SnapshotResult[] },
): TaskOutput | null {
  if (!result.success) return null;
  if (call.toolName === "browser_screenshot") {
    let payload: unknown;
    try {
      payload = JSON.parse(result.output || "{}");
    } catch {
      return null;
    }
    const parsed = screenshotOutputSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      id: `${context.runId}:${call.id}`,
      runId: context.runId,
      conversationId: context.conversationId,
      kind: "screenshot",
      type: "png",
      path: parsed.data.path,
      mimeType: "image/png",
      sourceTool: call.toolName,
      createdAt: result.completedAt ?? Date.now(),
    };
  }
  if (call.toolName === "write_file" || call.toolName === "apply_patch") {
    const path = callArgumentString(call, ["path", "file_path"]);
    if (!path) return null;
    // Only *created* files qualify: snapshotBeforeMutation recorded the file
    // as non-existent right before this call mutated it.
    const created = context.newSnapshots.some(
      (snapshot) => snapshot.file_path === path && !snapshot.existed,
    );
    if (!created || !isArtifactPath(path)) return null;
    const extension = extensionOf(path);
    return {
      id: `${context.runId}:${call.id}`,
      runId: context.runId,
      conversationId: context.conversationId,
      kind: "created-file",
      type: extension,
      path,
      ...(mimeTypeForPath(path) ? { mimeType: mimeTypeForPath(path) } : {}),
      sourceTool: call.toolName,
      createdAt: result.completedAt ?? Date.now(),
    };
  }
  return null;
}

export interface DeriveRunOutputsContext {
  runId: string;
  conversationId: string;
}

/** Recompute the full output set for a persisted run record. */
export function deriveTaskOutputs(
  toolCalls: readonly ToolCallRecord[],
  toolResults: readonly ToolResultRecord[],
  snapshots: readonly SnapshotResult[],
  context: DeriveRunOutputsContext,
): TaskOutput[] {
  const resultsByCallId = new Map(toolResults.map((result) => [result.toolCallId, result]));
  const outputs: TaskOutput[] = [];
  for (const call of toolCalls) {
    const result = resultsByCallId.get(call.id);
    if (!result) continue;
    // Re-derivation cannot know which snapshots belonged to which call;
    // every non-existing snapshot is a creation candidate, and the output
    // identity (runId:callId) deduplicates repeats of the same file.
    const output = deriveTaskOutput(call, result, {
      ...context,
      newSnapshots: snapshots.filter((snapshot) => !snapshot.existed),
    });
    if (output) outputs.push(output);
  }
  const seen = new Set<string>();
  const seenPaths = new Set<string>();
  return outputs.filter((output) => {
    if (seen.has(output.id)) return false;
    // A file rewritten later in the same run yields one output, not two.
    const pathKey = `${output.runId}:${output.path}`;
    if (output.kind === "created-file" && seenPaths.has(pathKey)) return false;
    seen.add(output.id);
    if (output.kind === "created-file") seenPaths.add(pathKey);
    return true;
  });
}

export function mergeTaskOutputs(
  previous: readonly TaskOutput[],
  current: readonly TaskOutput[],
): TaskOutput[] {
  const byId = new Map<string, TaskOutput>();
  for (const output of [...previous, ...current]) {
    if (!byId.has(output.id)) byId.set(output.id, output);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}
