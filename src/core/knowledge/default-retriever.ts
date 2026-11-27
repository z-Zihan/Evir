import { FtsKnowledgeRetriever } from "./fts-retrieval";
import type { KnowledgeRetriever } from "./retrieval";

/**
 * Default retriever: FTS5 candidate prefilter on desktop (KNOW-2), in-memory
 * keyword scan everywhere else (capability branch). Constructed lazily to
 * avoid a module-init Tauri dependency.
 *
 * Composed in its own module (§32-38): `fts-retrieval.ts` falls back to the
 * keyword retriever defined in `retrieval.ts`, so neither of those two can
 * own this composition without a runtime import cycle.
 */
let cached: KnowledgeRetriever | null = null;
export const defaultKnowledgeRetriever: KnowledgeRetriever = {
  retrieve(storage, input) {
    cached ??= new FtsKnowledgeRetriever();
    return cached.retrieve(storage, input);
  },
};
