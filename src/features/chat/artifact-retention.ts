import { logger } from "../../core/logging/logger";
import type { MessageRecord } from "../../core/storage/db";
import type { StorageMutation, StoragePort } from "../../core/storage/storage-port";
import { getStructuredStorage } from "../../runtime/structured-storage";

/**
 * Artifacts retention P1 (see artifacts-retention design brief):
 * - P1a: sweep tool-output / summary archives whose conversation is gone and
 *   that no surviving message still references (branches copy summaries and
 *   archived-output markers verbatim, mirroring conversation-ops' guard).
 * - P1b: cap workspace StoredArtifacts (relatedEntityId === null) by count,
 *   oldest createdAt first. Their ids are deterministic content hashes, so a
 *   deleted entry is rebuilt the next time its code block is opened.
 */

export const DEFAULT_STORED_ARTIFACT_LIMIT = 200;

export interface ArtifactRetentionResult {
  deletedOrphanSummaries: number;
  deletedOrphanToolOutputs: number;
  deletedLruStoredArtifacts: number;
}

interface ArtifactRow {
  id: string;
  type?: string;
  relatedEntityId?: string | null;
  createdAt?: number;
}

const EMPTY_RESULT: ArtifactRetentionResult = {
  deletedOrphanSummaries: 0,
  deletedOrphanToolOutputs: 0,
  deletedLruStoredArtifacts: 0,
};

export async function runArtifactRetention(
  storage: StoragePort,
  options: { storedArtifactLimit?: number } = {},
): Promise<ArtifactRetentionResult> {
  const limit = Math.max(0, options.storedArtifactLimit ?? DEFAULT_STORED_ARTIFACT_LIMIT);
  try {
    // One snapshot up front; deletions then land in a single atomic batch.
    const [artifacts, messages] = await Promise.all([
      storage.readAll<ArtifactRow>("artifacts"),
      storage.readAll<MessageRecord>("messages"),
    ]);
    const referencedArchiveIds = new Set(
      messages.flatMap(({ summaryMetadata }) =>
        summaryMetadata ? [summaryMetadata.archiveId] : [],
      ),
    );
    const toolOutputs = messages.flatMap(({ toolResults }) =>
      (toolResults ?? []).map(({ output }) => output),
    );
    const conversationExists = new Map<string, Promise<boolean>>();
    const hasConversation = (id: string) => {
      let exists = conversationExists.get(id);
      if (!exists) {
        exists = storage.read("conversations", id).then((record) => record !== undefined);
        conversationExists.set(id, exists);
      }
      return exists;
    };

    const orphanSummaries: string[] = [];
    const orphanToolOutputs: string[] = [];
    const storedArtifacts: ArtifactRow[] = [];
    for (const artifact of artifacts) {
      const { relatedEntityId } = artifact;
      if (relatedEntityId === null) {
        storedArtifacts.push(artifact);
        continue;
      }
      if (typeof relatedEntityId !== "string") continue;
      if (await hasConversation(relatedEntityId)) continue;
      if (artifact.type === "tool-output-source") {
        if (!toolOutputs.some((output) => output.includes(artifact.id))) {
          orphanToolOutputs.push(artifact.id);
        }
      } else if (!referencedArchiveIds.has(artifact.id)) {
        orphanSummaries.push(artifact.id);
      }
    }

    const lruStoredArtifacts = storedArtifacts
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .slice(0, Math.max(0, storedArtifacts.length - limit))
      .map(({ id }) => id);

    const mutations: StorageMutation[] = [
      ...orphanSummaries,
      ...orphanToolOutputs,
      ...lruStoredArtifacts,
    ].map((id) => ({ type: "delete", entity: "artifacts", id }));
    if (mutations.length > 0) await storage.apply(mutations);

    const result: ArtifactRetentionResult = {
      deletedOrphanSummaries: orphanSummaries.length,
      deletedOrphanToolOutputs: orphanToolOutputs.length,
      deletedLruStoredArtifacts: lruStoredArtifacts.length,
    };
    logger.info("artifact", "artifact.retention-swept", {
      ...result,
      scannedArtifacts: artifacts.length,
      storedArtifactLimit: limit,
    });
    return result;
  } catch (error) {
    // Retention is best-effort housekeeping: it must never break startup.
    logger.warn("artifact", "artifact.retention-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...EMPTY_RESULT };
  }
}

const IDLE_FALLBACK_DELAY_MS = 5_000;
let retentionScheduled = false;

/** Schedules a single idle-time retention sweep per app session. */
export function scheduleArtifactRetention(): void {
  if (retentionScheduled) return;
  retentionScheduled = true;
  const run = () => {
    void runArtifactRetention(getStructuredStorage());
  };
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: IDLE_FALLBACK_DELAY_MS });
  } else {
    setTimeout(run, IDLE_FALLBACK_DELAY_MS);
  }
}

/** Test-only: re-arms the once guard of {@link scheduleArtifactRetention}. */
export function resetArtifactRetentionScheduleForTests(): void {
  retentionScheduled = false;
}
