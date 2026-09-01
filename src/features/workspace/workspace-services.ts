import { getStructuredStorage } from "../../runtime/structured-storage";
import {
  desktopStorage,
  type FileInfo,
  type GitStatusResult,
} from "../../runtime/desktop-storage-adapter";
import { getActiveWorkspaceRoot } from "../../core/workspace/active-root";
import type { AgentRunRecord } from "../chat/agent-run-record";
import { countDiffLines, filterUnifiedDiffByFile, synthesizeAddedDiff } from "./changes-model";

/**
 * Service layer between workspace UI and storage ports: components never
 * touch Tauri commands directly (architecture dependency direction).
 */

export interface StoredArtifact {
  id: string;
  language: string;
  title?: string;
  content: string;
  createdAt: number;
}

const ARTIFACT_MAX_BYTES = 2_000_000;

/** Persist a chat-fence artifact so the workspace can re-open it later. */
export async function saveArtifact(input: {
  id: string;
  language: string;
  title?: string;
  content: string;
}): Promise<void> {
  if (input.content.length > ARTIFACT_MAX_BYTES) return;
  await getStructuredStorage().write("artifacts", input.id, {
    id: input.id,
    relatedEntityId: null,
    createdAt: Date.now(),
    language: input.language,
    ...(input.title ? { title: input.title } : {}),
    content: input.content,
  } satisfies StoredArtifact & { relatedEntityId: string | null });
}

export async function loadArtifact(id: string): Promise<StoredArtifact | null> {
  const record = await getStructuredStorage().read<StoredArtifact>("artifacts", id);
  return record ?? null;
}

export function listDirectory(path: string): Promise<FileInfo[]> {
  return desktopStorage.listDir(path);
}

export function searchProjectFiles(root: string, pattern: string): Promise<string[]> {
  return desktopStorage.searchFiles(root, pattern);
}

export function readTextFile(path: string): Promise<string> {
  return desktopStorage.readFile(path);
}

export function readBinaryBase64(path: string): Promise<string> {
  return desktopStorage.readFileBase64(path);
}

export function gitStatusFor(root: string): Promise<GitStatusResult> {
  return desktopStorage.gitStatus(root);
}

export function gitDiffFor(root: string): Promise<string> {
  return desktopStorage.gitDiff(root, false);
}

export function statFile(path: string) {
  return desktopStorage.fileStat(path);
}

export function relativeToRoot(absolutePath: string, root: string | null): string {
  if (!root) return absolutePath;
  const normalizedPath = absolutePath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedPath === normalizedRoot) return ".";
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return absolutePath;
}

export interface ResolvedFileDiff {
  diff: string;
  /** null when the diff could not be produced (not a repo / unavailable). */
  reason?: "not-a-repo" | "no-section" | "unreadable";
}

/**
 * Produce a unified diff for one changed file of a run: repo diff section
 * when available, synthesized full-addition diff for created files.
 */
export async function resolveChangeDiff(
  change: { path: string; changeType: "added" | "modified" | "deleted" },
  root: string | null,
): Promise<ResolvedFileDiff> {
  let synthesize = change.changeType === "added";
  if (root) {
    try {
      const status = await gitStatusFor(root);
      if (status.is_repo) {
        const relative = relativeToRoot(change.path, root);
        const diff = filterUnifiedDiffByFile(await gitDiffFor(root), relative);
        if (diff) return { diff };
        // Untracked files never appear in `git diff`, but a retried run can
        // record them as "modified" (the snapshot saw the earlier attempt's
        // file) — still synthesize the full-addition diff from disk.
        if (status.entries.some((entry) => entry.status === "??" && entry.file === relative)) {
          synthesize = true;
        } else if (!synthesize) {
          return { diff: "", reason: "no-section" };
        }
      }
    } catch {
      // fall through to synthesis
    }
  }
  if (synthesize) {
    try {
      const content = await readTextFile(change.path);
      return { diff: synthesizeAddedDiff(change.path, content) };
    } catch {
      return { diff: "", reason: "unreadable" };
    }
  }
  return { diff: "", reason: root ? "not-a-repo" : "no-section" };
}

/** Aggregate +/− line counts across every change of a run. */
export async function summarizeRunChanges(
  record: Pick<AgentRunRecord, "id">,
  changes: readonly { path: string; changeType: "added" | "modified" | "deleted" }[],
  root: string | null,
): Promise<{ files: number; additions: number; deletions: number }> {
  let additions = 0;
  let deletions = 0;
  const status = root ? await gitStatusFor(root).catch(() => null) : null;
  const repoDiff = status?.is_repo && root ? await gitDiffFor(root).catch(() => "") : "";
  for (const change of changes) {
    if (repoDiff) {
      const section = filterUnifiedDiffByFile(repoDiff, relativeToRoot(change.path, root));
      if (section) {
        const counts = countDiffLines(section);
        additions += counts.additions;
        deletions += counts.deletions;
        continue;
      }
    }
    if (change.changeType === "added") {
      try {
        const content = await readTextFile(change.path);
        additions += content.split("\n").filter((line) => line !== "").length;
      } catch {
        // file may be gone already
      }
    }
  }
  return { files: changes.length, additions, deletions };
}

export function activeRootOrNull(): string | null {
  return getActiveWorkspaceRoot();
}
