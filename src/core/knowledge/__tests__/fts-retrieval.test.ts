// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FtsKnowledgeRetriever } from "../fts-retrieval";
import { KeywordKnowledgeRetriever, tokenize } from "../retrieval";
import type { StoragePort } from "../../storage/storage-port";
import type {
  KnowledgeBaseRecord,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  KnowledgeSourceRecord,
} from "../types";

/**
 * KNOW-2: the FTS retriever delegates scoring/rendering/no-result honesty to
 * the keyword retriever over the DB-prefiltered candidate set; non-desktop
 * runtimes keep the pure keyword path (capability branch).
 */

const invokeMock = vi.fn();

afterEach(() => {
  invokeMock.mockClear();
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown): Promise<unknown> =>
    invokeMock(command, args) as Promise<unknown>,
}));

function base(id: string): KnowledgeBaseRecord {
  return { id, name: id, enabled: true, createdAt: 1, updatedAt: 1 };
}

function source(id: string, baseId: string): KnowledgeSourceRecord {
  return {
    id,
    baseId,
    title: `source ${id}`,
    type: "local-folder",
    ref: "/docs",
    enabled: true,
    servingState: "ready",
    indexingState: "idle",
    createdAt: 1,
    updatedAt: 1,
  } as KnowledgeSourceRecord;
}

function document(id: string, baseId: string, title: string): KnowledgeDocumentRecord {
  return {
    id,
    sourceId: `s-${baseId}`,
    baseId,
    title,
    location: `/docs/${id}.md`,
    contentHash: "x".repeat(8),
    charCount: 10,
    updatedAt: 1,
  };
}

function chunk(id: string, baseId: string, heading: string, text: string): KnowledgeChunkRecord {
  return {
    id,
    sourceId: `s-${baseId}`,
    documentId: `d-${baseId}`,
    baseId,
    ordinal: 0,
    text,
    heading,
    updatedAt: 1,
  };
}

function storage(
  rows: Partial<Record<"bases" | "sources" | "documents" | "chunks", unknown[]>>,
): StoragePort {
  return {
    readAll: (entity: string) => {
      const table = (
        {
          knowledge_bases: rows.bases,
          knowledge_sources: rows.sources,
          knowledge_documents: rows.documents,
          knowledge_chunks: rows.chunks,
        } as Record<string, unknown[] | undefined>
      )[entity];
      return Promise.resolve([...(table ?? [])]);
    },
  } as unknown as StoragePort;
}

describe("tokenize (shared)", () => {
  it("produces word tokens and CJK bigrams", () => {
    const tokens = tokenize("Deploy 部署流程 notes");
    expect(tokens.has("deploy")).toBe(true);
    expect(tokens.has("notes")).toBe(true);
    expect(tokens.has("部署")).toBe(true);
    expect(tokens.has("署流")).toBe(true);
  });
});

describe("FtsKnowledgeRetriever (KNOW-2)", () => {
  it("scores the DB-prefiltered candidate set with keyword semantics", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue(["c1"]);

    const store = storage({
      bases: [base("b1")],
      sources: [source("s-b1", "b1")],
      documents: [document("d-b1", "b1", "Deploy guide")],
      chunks: [
        chunk("c1", "b1", "Deploy", "database indexing strategy for deployment"),
        chunk("c2", "b1", "Cooking", "unrelated recipe the prefilter excluded"),
      ],
    });

    const retriever = new FtsKnowledgeRetriever();
    const result = await retriever.retrieve(store, {
      baseIds: ["b1"],
      query: "deployment strategy",
    });
    expect(result.noResult).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.chunk.id).toBe("c1");
    expect(result.context).toContain("Deploy guide");
    expect(invokeMock).toHaveBeenCalledWith(
      "knowledge_fts_search",
      expect.objectContaining({ baseIds: ["b1"] }),
    );

    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("an empty candidate set is an honest no-result (searched, nothing matched)", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue([]);

    const store = storage({
      bases: [base("b1")],
      sources: [source("s-b1", "b1")],
      documents: [document("d-b1", "b1", "Guide")],
      chunks: [chunk("c1", "b1", "", "nothing relevant")],
    });
    const result = await new FtsKnowledgeRetriever().retrieve(store, {
      baseIds: ["b1"],
      query: "deployment strategy",
    });
    expect(result.noResult).toBe(true);
    expect(result.results).toHaveLength(0);

    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("non-desktop runtimes delegate to the keyword retriever (capability branch)", async () => {
    // No __TAURI_INTERNALS__: pure delegation, no invoke.
    const store = storage({
      bases: [base("b1")],
      sources: [source("s-b1", "b1")],
      documents: [document("d-b1", "b1", "Guide")],
      chunks: [chunk("c1", "b1", "Deploy", "database indexing strategy")],
    });
    const spy = vi.spyOn(KeywordKnowledgeRetriever.prototype, "retrieve");
    const result = await new FtsKnowledgeRetriever().retrieve(store, {
      baseIds: ["b1"],
      query: "deployment strategy",
    });
    expect(spy).toHaveBeenCalled();
    expect(result.noResult).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("an FTS failure falls back to the keyword scan instead of faking no-result", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockRejectedValue(new Error("ipc stall"));

    const store = storage({
      bases: [base("b1")],
      sources: [source("s-b1", "b1")],
      documents: [document("d-b1", "b1", "Guide")],
      chunks: [chunk("c1", "b1", "Deploy", "database indexing strategy")],
    });
    const result = await new FtsKnowledgeRetriever().retrieve(store, {
      baseIds: ["b1"],
      query: "deployment strategy",
    });
    expect(result.noResult).toBe(false);
    expect(result.results[0]?.chunk.id).toBe("c1");

    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });
});
