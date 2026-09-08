/**
 * Knowledge Base v1 (§52-71): explicit local/web knowledge sources with
 * ingested, chunked, retrievable content — kept strictly separate from
 * Memory (user/session/task retention). All records live in the structured
 * entity store, so profile isolation is inherited per storage database.
 */
import { z } from "zod";

export const KNOWLEDGE_SOURCE_TYPES = [
  "local-file",
  "local-folder",
  "project-docs",
  "web-url",
  "mcp-resource",
  "historical-task",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const knowledgeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type KnowledgeBaseRecord = z.output<typeof knowledgeBaseSchema>;

export const knowledgeSourceSchema = z.object({
  id: z.string().min(1),
  baseId: z.string().min(1),
  type: z.enum(KNOWLEDGE_SOURCE_TYPES),
  /** Human title shown in UI lists. */
  title: z.string().min(1).max(200),
  /** Absolute path, URL, or opaque reference — never deleted by Evir. */
  ref: z.string().min(1).max(2_000),
  enabled: z.boolean(),
  status: z.enum(["pending", "indexing", "ready", "failed"]),
  error: z.string().max(600).optional(),
  lastIndexedAt: z.number().int().nonnegative().optional(),
  docCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type KnowledgeSourceRecord = z.output<typeof knowledgeSourceSchema>;

export const knowledgeDocumentSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  baseId: z.string().min(1),
  title: z.string().min(1).max(300),
  /** Path/URL the content came from (provenance, §61). */
  location: z.string().min(1).max(2_000),
  contentHash: z.string().min(8).max(128),
  charCount: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type KnowledgeDocumentRecord = z.output<typeof knowledgeDocumentSchema>;

export const knowledgeChunkSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  sourceId: z.string().min(1),
  baseId: z.string().min(1),
  /** Order of the chunk within its document. */
  ordinal: z.number().int().nonnegative(),
  text: z.string().min(1),
  /** Nearest preceding markdown heading (structure-first chunking, §58). */
  heading: z.string().max(300).optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type KnowledgeChunkRecord = z.output<typeof knowledgeChunkSchema>;

/** A retrieval hit with provenance kept for citation (§61). */
export interface RetrievedKnowledge {
  chunk: KnowledgeChunkRecord;
  documentTitle: string;
  location: string;
  sourceTitle: string;
  score: number;
}

/** Ingestion caps: bounded work, bounded storage (§57). */
export const MAX_INGEST_FILE_BYTES = 2_000_000;
export const MAX_FOLDER_FILES = 500;
export const MAX_CHUNK_CHARS = 1_200;
export const MIN_CHUNK_CHARS = 80;

/** Extensions ingested as plain text (code included, §57). */
export const TEXT_INGEST_EXTENSIONS = [
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".rst",
  ".adoc",
  ".json",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".pdf",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".rb",
  ".sh",
  ".css",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".xml",
];

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

export function isIngestiblePath(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_INGEST_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
