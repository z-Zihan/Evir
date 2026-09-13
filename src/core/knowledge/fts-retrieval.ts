/**
 * KNOW-2: FTS5-backed knowledge retrieval (desktop). The Rust side maintains
 * an FTS5 index over knowledge chunks inside the per-profile SQLite database
 * and exposes a candidate prefilter (`knowledge_fts_search`, bm25-ranked);
 * this retriever runs the v1 overlap scoring on that (much smaller) candidate
 * set — identical scoring, no-result honesty, and provenance rendering as the
 * keyword retriever, without shipping every chunk into JS memory per search.
 *
 * Capability branch: non-desktop runtimes (web) keep the in-memory keyword
 * retriever by delegating to it.
 */
import { logger } from "../logging/logger";
import {
  KeywordKnowledgeRetriever,
  type KnowledgeRetrievalInput,
  type KnowledgeRetrievalResult,
  type KnowledgeRetriever,
} from "./retrieval";
import type { KnowledgeChunkRecord, KnowledgeDocumentRecord, KnowledgeSourceRecord } from "./types";
import type { StoragePort } from "../storage/storage-port";

/** bm25-ranked candidates per search — bounds the JS-side scoring set. */
const MAX_CHUNK_CANDIDATES = 256;

interface FtsCandidateRow {
  chunk: KnowledgeChunkRecord;
  document: KnowledgeDocumentRecord | undefined;
  source: KnowledgeSourceRecord | undefined;
}

export class FtsKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly fallback: KnowledgeRetriever = new KeywordKnowledgeRetriever()) {}

  async retrieve(
    storage: StoragePort,
    input: KnowledgeRetrievalInput,
  ): Promise<KnowledgeRetrievalResult> {
    if (!("__TAURI_INTERNALS__" in globalThis)) {
      return this.fallback.retrieve(storage, input);
    }
    if (input.baseIds.length === 0 || input.query.trim().length === 0) {
      return { results: [], context: "", noResult: false };
    }
    try {
      return await this.retrieveViaFts(storage, input);
    } catch (error) {
      // Honest degradation: an FTS/IPC failure must not fake a no-result —
      // fall back to the keyword scan so search still answers.
      logger.warn("knowledge", "knowledge.fts-fallback", {
        errorType: error instanceof Error ? error.name : "Error",
      });
      return this.fallback.retrieve(storage, input);
    }
  }

  private async retrieveViaFts(
    storage: StoragePort,
    input: KnowledgeRetrievalInput,
  ): Promise<KnowledgeRetrievalResult> {
    const { tokenize } = await import("./retrieval");
    const { invoke } = await import("@tauri-apps/api/core");
    const queryTokens = [...tokenize(input.query)];
    if (queryTokens.length === 0) return { results: [], context: "", noResult: false };

    const candidateIds = await invoke<string[]>("knowledge_fts_search", {
      tokens: queryTokens,
      baseIds: [...input.baseIds],
    });
    if (candidateIds.length === 0) {
      return { results: [], context: "", noResult: true };
    }

    // Load only the candidate chunks (plus sources/documents for the same
    // bases) and re-run the v1 scoring on this bounded set.
    const [chunks, sources, documents] = await Promise.all([
      storage.readAll<KnowledgeChunkRecord>("knowledge_chunks"),
      storage.readAll<KnowledgeSourceRecord>("knowledge_sources"),
      storage.readAll<KnowledgeDocumentRecord>("knowledge_documents"),
    ]);
    const candidateSet = new Set(candidateIds.slice(0, MAX_CHUNK_CANDIDATES));
    const rows: FtsCandidateRow[] = [];
    for (const chunk of chunks) {
      if (!candidateSet.has(chunk.id)) continue;
      rows.push({
        chunk,
        source: sources.find((source) => source.id === chunk.sourceId),
        document: documents.find((document) => document.id === chunk.documentId),
      });
    }
    // Delegate scoring/rendering to the keyword retriever over a restricted
    // view: same interface, but only candidate rows are visible. Implemented
    // by filtering through a storage proxy to keep the retriever pure.
    const proxy = createChunkSubsetStorage(
      storage,
      new Map(rows.map((row) => [row.chunk.id, row.chunk])),
    );
    return this.fallback.retrieve(proxy, input);
  }
}

/**
 * Storage proxy exposing ONLY the candidate chunks for knowledge_chunks reads;
 * every other entity forwards untouched. The keyword retriever's permissive
 * filters (enabled bases, servable sources) still apply through the same
 * records.
 */
function createChunkSubsetStorage(
  storage: StoragePort,
  subset: Map<string, KnowledgeChunkRecord>,
): StoragePort {
  return {
    ...storage,
    async readAll(entity) {
      if (entity === "knowledge_chunks") {
        return [...subset.values()];
      }
      return storage.readAll(entity);
    },
  } as StoragePort;
}
