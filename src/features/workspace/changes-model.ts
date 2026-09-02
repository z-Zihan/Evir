import type { ToolCallRecord, ToolResultRecord } from "../../core/storage/db";
import type { SnapshotResult } from "../../runtime/desktop-storage-adapter";

/**
 * Run-scoped change derivation. The de-facto ground truth of "what did this
 * run touch" is the snapshot chain: every mutating tool snapshots the target
 * file first, recording whether it existed before the mutation.
 */

export type ChangeType = "added" | "modified" | "deleted";

export interface ChangeEntry {
  /** Absolute path of the changed file. */
  path: string;
  changeType: ChangeType;
  toolName: string;
  runId: string;
  createdAt: number;
}

const MUTATING_TOOLS = new Set([
  "write_file",
  "apply_patch",
  "create_snapshot",
  "restore_snapshot",
]);

function callPath(call: ToolCallRecord): string | null {
  const value = call.arguments["path"] ?? call.arguments["file_path"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizedFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path) || path.startsWith("//");
}

/** Match a tool's project-relative path to the absolute path returned by snapshots. */
export function matchingSnapshotForPath(
  snapshots: readonly SnapshotResult[],
  path: string,
): SnapshotResult | undefined {
  const normalized = normalizedFilePath(path);
  const exact = snapshots.find((snapshot) => normalizedFilePath(snapshot.file_path) === normalized);
  if (exact) return exact;
  if (isAbsoluteFilePath(normalized)) return undefined;
  const suffix = `/${normalized.replace(/^\/+/, "")}`;
  const candidates = snapshots.filter((snapshot) =>
    normalizedFilePath(snapshot.file_path).endsWith(suffix),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Derive a run's change list from its tool records + snapshots. Files the run
 * created and then modified collapse into one "added" entry; the newest
 * successful mutation wins.
 */
export function deriveChanges(
  toolCalls: readonly ToolCallRecord[],
  toolResults: readonly ToolResultRecord[],
  snapshots: readonly SnapshotResult[],
  runId: string,
): ChangeEntry[] {
  const resultsByCallId = new Map(toolResults.map((result) => [result.toolCallId, result]));
  const byPath = new Map<string, ChangeEntry>();
  for (const call of toolCalls) {
    const result = resultsByCallId.get(call.id);
    if (!result?.success || !MUTATING_TOOLS.has(call.toolName)) continue;
    const path = callPath(call);
    if (!path) continue;
    const snapshot = matchingSnapshotForPath(snapshots, path);
    const resolvedPath = snapshot?.file_path ?? path;
    const existed = snapshot?.existed;
    const changeType: ChangeType =
      existed === undefined || existed === false
        ? "added"
        : call.toolName === "restore_snapshot"
          ? "modified"
          : "modified";
    // A later mutation of the same path replaces the entry, but a file the
    // run created stays "added" even after follow-up edits.
    const previous = byPath.get(resolvedPath);
    if (previous?.changeType === "added" && changeType === "modified") continue;
    byPath.set(resolvedPath, {
      path: resolvedPath,
      changeType,
      toolName: call.toolName,
      runId,
      createdAt: result.completedAt ?? Date.now(),
    });
  }
  return [...byPath.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Extract a single file's section from a unified diff covering the whole
 * repository. `relativePath` is the repo-relative path (forward slashes).
 * Git quotes paths containing spaces or non-ASCII (e.g. Chinese) characters,
 * so both the plain and the quoted header forms must match. Returns "" when
 * the file has no section (untracked files never appear in `git diff`).
 */
export function filterUnifiedDiffByFile(diff: string, relativePath: string): string {
  if (!diff) return "";
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const plain = `diff --git a/${normalized} b/${normalized}`;
  const quoted = `diff --git "a/${normalized}" "b/${normalized}"`;
  const sections = diff.split(/(?=^diff --git )/m);
  for (const section of sections) {
    const headerEnd = section.indexOf("\n");
    const header = headerEnd === -1 ? section : section.slice(0, headerEnd);
    if (header === plain || header === quoted) {
      return section.trimEnd();
    }
  }
  return "";
}

/** Build a unified diff for a newly created file (git never diffs untracked). */
export function synthesizeAddedDiff(path: string, content: string): string {
  const fileName = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const body = content.split("\n");
  const lastEmpty = body.length > 0 && body[body.length - 1] === "";
  const lineCount = lastEmpty ? body.length - 1 : body.length;
  const header = `diff --git a/${fileName} b/${fileName}\nnew file mode 100644\n--- /dev/null\n+++ b/${fileName}\n@@ -0,0 +1,${lineCount} @@`;
  const bodyLines = body.slice(0, lastEmpty ? -1 : undefined).map((line) => `+${line}`);
  return [header, ...bodyLines].join("\n");
}

/** Count +/- lines of a unified diff section, excluding headers. */
export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}
