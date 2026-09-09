/**
 * Knowledge retrieval benchmark (§39/§64): measures the shipped Keyword
 * Retriever v1 (read-all + tokenize + overlap scoring — NOT FTS) at 1k/10k/
 * 50k/100k chunks so the SQLite-FTS5 upgrade decision has real thresholds.
 *
 * Metrics per scale: index build+write time, query latency p50/p95 across
 * mixed zh/en queries, and heap delta around retrieval.
 *
 * Run: pnpm benchmark:knowledge         (full scales)
 *      EVIR_KB_BENCH_QUICK=1 ...        (1k/10k only, for CI smoke)
 * Writes docs/benchmarks/knowledge-retrieval.json and prints a table.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { KeywordKnowledgeRetriever } from "../../src/core/knowledge/retrieval";
import type { StoragePort } from "../../src/core/storage/storage-port";

const SCALES = process.env.EVIR_KB_BENCH_QUICK ? [1_000, 10_000] : [1_000, 10_000, 50_000, 100_000];

const QUERIES = [
  "deployment rollback strategy",
  "数据库连接池配置",
  "authentication token refresh",
  "知识库检索阈值",
  "snapshot restore failure",
  "接口超时重试策略 retry timeout",
];
const WARMUP = 2;
const RUNS = 10;

/** Deterministic pseudo-corpus: enough lexical variety to be scored. */
function chunkText(index: number): string {
  const topics = [
    "deployment rollback strategy blue green",
    "数据库 连接池 配置 池上限",
    "authentication token refresh rotation",
    "知识库 检索 阈值 关键词",
    "snapshot restore failure recovery",
    "接口 超时 重试 策略",
    "workspace boundary permission roots",
    "stream batching render pipeline",
  ];
  const topic = topics[index % topics.length]!;
  const filler = `chunk ${index} of corpus alpha beta gamma delta epsilon zeta`;
  return `${topic} — ${filler} ${topic}`;
}

function memoryStorage(): StoragePort {
  const data = new Map<string, Map<string, object>>();
  const bucket = (entity: string) => {
    if (!data.has(entity)) data.set(entity, new Map());
    return data.get(entity)!;
  };
  return {
    read: ((entity: string, id: string) => Promise.resolve(bucket(entity).get(id))) as never,
    readAll: ((entity: string) => Promise.resolve([...bucket(entity).values()])) as never,
    write: ((entity: string, id: string, value: object) => {
      bucket(entity).set(id, value);
      return Promise.resolve();
    }) as never,
    writeMany: ((entity: string, values: readonly object[]) => {
      for (const value of values) bucket(entity).set((value as { id: string }).id, value);
      return Promise.resolve();
    }) as never,
    delete: (entity: string, id: string) => {
      bucket(entity).delete(id);
      return Promise.resolve();
    },
    deleteMany: (entity: string, ids: string[]) => {
      for (const id of ids) bucket(entity).delete(id);
      return Promise.resolve();
    },
    clear: (entity: string) => {
      bucket(entity).clear();
      return Promise.resolve();
    },
    query: () => Promise.resolve([] as never),
    apply: ((mutations: readonly { type: string; entity: string; id: string; data?: object }[]) => {
      for (const mutation of mutations) {
        if (mutation.type === "write") bucket(mutation.entity).set(mutation.id, mutation.data!);
        else if (mutation.type === "delete") bucket(mutation.entity).delete(mutation.id);
        else if (mutation.type === "clear") bucket(mutation.entity).clear();
      }
      return Promise.resolve();
    }) as never,
  };
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

interface ScaleResult {
  scale: number;
  indexMs: number;
  queryP50Ms: number;
  queryP95Ms: number;
  heapDeltaMb: number;
  samples: number;
}

describe("knowledge retrieval benchmark (Keyword Retriever v1)", () => {
  it("measures index time and query latency per scale", { timeout: 600_000 }, async () => {
    const retriever = new KeywordKnowledgeRetriever();
    const results: ScaleResult[] = [];

    for (const scale of SCALES) {
      const storage = memoryStorage();
      const documents: object[] = [];
      const chunks: object[] = [];
      const t0 = performance.now();
      for (let index = 0; index < scale; index += 1) {
        const documentId = `doc-${index}`;
        documents.push({
          id: documentId,
          sourceId: "ks-bench",
          baseId: "kb-bench",
          title: `Doc ${index}`,
          location: `/ws/docs/doc-${index}.md`,
          contentHash: `${index}`,
          charCount: 100,
          updatedAt: index,
        });
        chunks.push({
          id: `kc-${index}`,
          documentId,
          sourceId: "ks-bench",
          baseId: "kb-bench",
          heading: null,
          text: chunkText(index),
          updatedAt: index,
        });
      }
      await storage.apply([
        {
          type: "write",
          entity: "knowledge_bases",
          id: "kb-bench",
          data: {
            id: "kb-bench",
            name: "Bench",
            enabled: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        {
          type: "write",
          entity: "knowledge_sources",
          id: "ks-bench",
          data: {
            id: "ks-bench",
            baseId: "kb-bench",
            type: "local-folder",
            title: "Bench",
            ref: "/ws/docs",
            enabled: true,
            status: "ready",
            docCount: documents.length,
            chunkCount: chunks.length,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        ...documents.map(
          (record) =>
            ({
              type: "write",
              entity: "knowledge_documents",
              id: (record as { id: string }).id,
              data: record,
            }) as const,
        ),
        ...chunks.map(
          (record) =>
            ({
              type: "write",
              entity: "knowledge_chunks",
              id: (record as { id: string }).id,
              data: record,
            }) as const,
        ),
      ]);
      const indexMs = performance.now() - t0;

      for (let run = 0; run < WARMUP; run += 1) {
        await retriever.retrieve(storage, { baseIds: ["kb-bench"], query: QUERIES[0]! });
      }
      const latencySamples: number[] = [];
      const heapBefore = process.memoryUsage().heapUsed;
      for (const query of QUERIES) {
        for (let run = 0; run < RUNS; run += 1) {
          const start = performance.now();
          const result = await retriever.retrieve(storage, { baseIds: ["kb-bench"], query });
          latencySamples.push(performance.now() - start);
          if (result.results.length === 0 && !result.noResult) {
            throw new Error(`query returned nothing at scale ${scale}: ${query}`);
          }
        }
      }
      const heapAfter = process.memoryUsage().heapUsed;
      latencySamples.sort((a, b) => a - b);
      const entry: ScaleResult = {
        scale,
        indexMs: Math.round(indexMs),
        queryP50Ms: Number(percentile(latencySamples, 0.5).toFixed(1)),
        queryP95Ms: Number(percentile(latencySamples, 0.95).toFixed(1)),
        heapDeltaMb: Number((Math.max(0, heapAfter - heapBefore) / 1024 / 1024).toFixed(1)),
        samples: latencySamples.length,
      };
      results.push(entry);
      console.info(
        `scale=${entry.scale} index=${entry.indexMs}ms p50=${entry.queryP50Ms}ms p95=${entry.queryP95Ms}ms heapΔ=${entry.heapDeltaMb}MB`,
      );
    }

    const outDir = path.join(process.cwd(), "docs", "benchmarks");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, "knowledge-retrieval.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          retriever: "KeywordKnowledgeRetriever v1 (keyword + CJK bigram, full scan)",
          notes:
            "Deterministic in-memory corpus. p50/p95 over 6 mixed zh/en queries x 10 runs after 2 warmups. Heap delta measured across the retrieval loop.",
          results,
        },
        null,
        2,
      ) + "\n",
    );
    console.info("wrote docs/benchmarks/knowledge-retrieval.json");
  });
});
