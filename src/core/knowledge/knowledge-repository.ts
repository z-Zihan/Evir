/**
 * Knowledge Base repository + ingestion pipeline (§54-68): bases/sources
 * CRUD over the structured entity store, reindex that replaces a source's
 * documents/chunks, and deletion that removes only the index — never the
 * user's original files. Local sources are permission-checked against the
 * project's granted roots before any read (§65).
 */
import type { StoragePort } from "../storage/storage-port";
import type { AgentRunRecord } from "../../features/chat/agent-run-record";
import { logger } from "../logging/logger";
import { chunkDocument } from "./chunking";
import { contentHash, extractContent } from "./extraction";
import { filterIngestibleFiles, type KnowledgeIoPort } from "./knowledge-io";
import {
  MAX_FOLDER_FILES,
  MAX_INGEST_FILE_BYTES,
  isPdfPath,
  type KnowledgeBaseRecord,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeSourceRecord,
  type KnowledgeSourceType,
} from "./types";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now(): number {
  return Date.now();
}

/** Roots a local source path must stay inside (workspace + extra roots, §65). */
export interface KnowledgePermissionRoots {
  workspaceRoot: string | null;
  additionalRoots: readonly string[];
}

function isInsideRoots(path: string, roots: KnowledgePermissionRoots): boolean {
  const allRoots = [roots.workspaceRoot, ...roots.additionalRoots].filter(
    (root): root is string => typeof root === "string" && root.length > 0,
  );
  if (allRoots.length === 0) return false;
  return allRoots.some((root) => {
    const normalizedRoot = root.replace(/\/+$/, "");
    return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
  });
}

export class KnowledgeRepository {
  constructor(private readonly storage: StoragePort) {}

  // --- bases ---------------------------------------------------------------

  async listBases(): Promise<KnowledgeBaseRecord[]> {
    const bases = await this.storage.readAll<KnowledgeBaseRecord>("knowledge_bases");
    return bases.sort((a, b) => a.createdAt - b.createdAt);
  }

  async createBase(input: { name: string; description?: string }): Promise<KnowledgeBaseRecord> {
    const base: KnowledgeBaseRecord = {
      id: uid("kb"),
      name: input.name.trim().slice(0, 120),
      ...(input.description ? { description: input.description.slice(0, 600) } : {}),
      enabled: true,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.storage.write("knowledge_bases", base.id, base);
    return base;
  }

  async updateBase(
    id: string,
    patch: { name?: string; description?: string; enabled?: boolean },
  ): Promise<KnowledgeBaseRecord | undefined> {
    const base = await this.storage.read<KnowledgeBaseRecord>("knowledge_bases", id);
    if (!base) return undefined;
    const updated: KnowledgeBaseRecord = {
      ...base,
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 120) || base.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description.slice(0, 600) || undefined }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: now(),
    };
    await this.storage.write("knowledge_bases", id, updated);
    return updated;
  }

  async deleteBase(id: string): Promise<void> {
    const sources = await this.listSources(id);
    for (const source of sources) await this.deleteSourceArtifacts(source.id);
    await this.storage.delete("knowledge_bases", id);
  }

  // --- sources ---------------------------------------------------------------

  async listSources(baseId?: string): Promise<KnowledgeSourceRecord[]> {
    const sources = await this.storage.readAll<KnowledgeSourceRecord>("knowledge_sources");
    return sources
      .filter((source) => baseId === undefined || source.baseId === baseId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async createSource(input: {
    baseId: string;
    type: KnowledgeSourceType;
    title: string;
    ref: string;
    permissionRoots?: KnowledgePermissionRoots;
  }): Promise<KnowledgeSourceRecord> {
    const base = await this.storage.read<KnowledgeBaseRecord>("knowledge_bases", input.baseId);
    if (!base) throw new Error("knowledge base not found");
    if (
      input.type === "local-file" ||
      input.type === "local-folder" ||
      input.type === "project-docs"
    ) {
      const roots = input.permissionRoots ?? { workspaceRoot: null, additionalRoots: [] };
      if (!isInsideRoots(input.ref, roots)) {
        throw new Error(
          "path is outside the project's granted roots — add it as an additional access root first",
        );
      }
    }
    if (input.type === "web-url") {
      try {
        const parsed = new URL(input.ref);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
          throw new Error("bad protocol");
      } catch {
        throw new Error("web source must be an http(s) URL");
      }
    }
    const source: KnowledgeSourceRecord = {
      id: uid("ks"),
      baseId: input.baseId,
      type: input.type,
      title: input.title.trim().slice(0, 200) || input.ref.slice(0, 200),
      ref: input.ref,
      enabled: true,
      status: "pending",
      docCount: 0,
      chunkCount: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.storage.write("knowledge_sources", source.id, source);
    return source;
  }

  async updateSource(
    id: string,
    patch: { title?: string; enabled?: boolean },
  ): Promise<KnowledgeSourceRecord | undefined> {
    const source = await this.storage.read<KnowledgeSourceRecord>("knowledge_sources", id);
    if (!source) return undefined;
    const updated: KnowledgeSourceRecord = {
      ...source,
      ...(patch.title !== undefined
        ? { title: patch.title.trim().slice(0, 200) || source.title }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedAt: now(),
    };
    await this.storage.write("knowledge_sources", id, updated);
    return updated;
  }

  /** Remove a source AND its index; the original file/URL is never touched (§68). */
  async deleteSource(id: string): Promise<void> {
    await this.deleteSourceArtifacts(id);
    await this.storage.delete("knowledge_sources", id);
  }

  private async deleteSourceArtifacts(sourceId: string): Promise<void> {
    const documents = (
      await this.storage.readAll<KnowledgeDocumentRecord>("knowledge_documents")
    ).filter((document) => document.sourceId === sourceId);
    const chunks = (await this.storage.readAll<KnowledgeChunkRecord>("knowledge_chunks")).filter(
      (chunk) => chunk.sourceId === sourceId,
    );
    await this.storage.deleteMany(
      "knowledge_chunks",
      chunks.map((chunk) => chunk.id),
    );
    await this.storage.deleteMany(
      "knowledge_documents",
      documents.map((document) => document.id),
    );
  }

  // --- ingestion ---------------------------------------------------------------

  /**
   * Reindex a source: read → extract → chunk → replace its documents/chunks.
   * Status moves indexing → ready|failed; failures keep the previous index
   * intact until a successful pass replaces it.
   */
  async reindexSource(
    source: KnowledgeSourceRecord,
    io: KnowledgeIoPort,
    options: { permissionRoots?: KnowledgePermissionRoots } = {},
  ): Promise<KnowledgeSourceRecord> {
    const mark = async (patch: Partial<KnowledgeSourceRecord>): Promise<KnowledgeSourceRecord> => {
      const current =
        (await this.storage.read<KnowledgeSourceRecord>("knowledge_sources", source.id)) ?? source;
      const updated: KnowledgeSourceRecord = { ...current, ...patch, updatedAt: now() };
      await this.storage.write("knowledge_sources", source.id, updated);
      return updated;
    };
    await mark({ status: "indexing", error: undefined });
    try {
      const documents = await this.collectDocuments(source, io, options.permissionRoots);
      const timestamp = now();
      const documentRecords: KnowledgeDocumentRecord[] = [];
      const chunkRecords: KnowledgeChunkRecord[] = [];
      for (const item of documents) {
        const documentId = `kd-${contentHash(`${source.id}:${item.location}`)}`;
        const record: KnowledgeDocumentRecord = {
          id: documentId,
          sourceId: source.id,
          baseId: source.baseId,
          title: item.title.slice(0, 300),
          location: item.location,
          contentHash: contentHash(item.text),
          charCount: item.text.length,
          updatedAt: timestamp,
        };
        documentRecords.push(record);
        chunkRecords.push(
          ...chunkDocument({
            documentId,
            sourceId: source.id,
            baseId: source.baseId,
            title: record.title,
            location: record.location,
            content: item.text,
            updatedAt: timestamp,
          }),
        );
      }
      // Replace the source's previous index in one pass.
      await this.deleteSourceArtifacts(source.id);
      if (documentRecords.length > 0) {
        await this.storage.writeMany("knowledge_documents", documentRecords);
        await this.storage.writeMany("knowledge_chunks", chunkRecords);
      }
      const updated = await mark({
        status: "ready",
        error: undefined,
        lastIndexedAt: timestamp,
        docCount: documentRecords.length,
        chunkCount: chunkRecords.length,
      });
      logger.info("knowledge", "knowledge.source-reindexed", {
        sourceId: source.id,
        type: source.type,
        documents: documentRecords.length,
        chunks: chunkRecords.length,
      });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("knowledge", "knowledge.source-reindex-failed", {
        sourceId: source.id,
        error: message,
      });
      return mark({ status: "failed", error: message.slice(0, 600) });
    }
  }

  private async collectDocuments(
    source: KnowledgeSourceRecord,
    io: KnowledgeIoPort,
    permissionRoots?: KnowledgePermissionRoots,
  ): Promise<{ location: string; title: string; text: string }[]> {
    switch (source.type) {
      case "local-file":
        return [await this.ingestOne(source.ref, io)];
      case "local-folder":
      case "project-docs": {
        if (permissionRoots && !isInsideRoots(source.ref, permissionRoots)) {
          throw new Error("folder is outside the project's granted roots");
        }
        const files = await filterIngestibleFiles(
          (folder) => io.listIngestibleFiles(folder),
          source.ref,
        );
        if (files.length === 0) throw new Error("no ingestible files found under the folder");
        const results: { location: string; title: string; text: string }[] = [];
        for (const file of files) {
          try {
            results.push(await this.ingestOne(file, io));
          } catch (error) {
            logger.warn("knowledge", "knowledge.file-skip-failed", {
              file,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (results.length === 0) throw new Error("all files under the folder failed to ingest");
        return results;
      }
      case "web-url": {
        const text = await io.fetchText(source.ref);
        const extracted = await extractContent(source.ref, { text });
        if (extracted.text.trim().length === 0) throw new Error("page had no extractable text");
        return [
          { location: source.ref, title: extracted.title || source.ref, text: extracted.text },
        ];
      }
      case "mcp-resource": {
        if (!io.listMcpResources || !io.readMcpResourceText) {
          throw new Error("MCP resources require the desktop app with an enabled MCP server");
        }
        const resources = await io.listMcpResources(source.ref);
        if (resources.length === 0) throw new Error("server exposes no resources");
        const results: { location: string; title: string; text: string }[] = [];
        for (const resource of resources.slice(0, MAX_FOLDER_FILES)) {
          try {
            const text = await io.readMcpResourceText(source.ref, resource.uri);
            if (text.trim().length > 0) {
              results.push({ location: resource.uri, title: resource.name, text });
            }
          } catch (error) {
            logger.warn("knowledge", "knowledge.mcp-resource-skip-failed", {
              uri: resource.uri.slice(0, 200),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (results.length === 0) throw new Error("no readable text resources on the server");
        return results;
      }
      case "historical-task": {
        // Derive the conversation's task outputs from persisted run records
        // and ingest those files — outputs are recomputed, never trusted
        // from model claims (task-output-model contract).
        const { deriveTaskOutput, isArtifactPath } =
          await import("../../features/workspace/task-output-model");
        const runs = (await this.storage.readAll<AgentRunRecord>("agent_runs")).filter(
          (run) => run.conversationId === source.ref,
        );
        if (runs.length === 0) throw new Error("conversation not found or has no runs");
        const executions = await this.storage.readAll<{
          id: string;
          toolCall?: unknown;
          result?: unknown;
        }>("tool_executions");
        const outputs: { location: string; title: string; text: string }[] = [];
        const seen = new Set<string>();
        for (const run of runs) {
          for (const execution of executions) {
            if (!execution.id.startsWith(`${run.id}:`)) continue;
            const call = execution.toolCall as never as
              Parameters<typeof deriveTaskOutput>[0] | undefined;
            const result = execution.result as Parameters<typeof deriveTaskOutput>[1] | undefined;
            if (!call || !result) continue;
            const output = deriveTaskOutput(call, result, {
              runId: run.id,
              conversationId: source.ref,
              newSnapshots: [],
            });
            if (!output || !isArtifactPath(output.path) || seen.has(output.path)) continue;
            seen.add(output.path);
            try {
              outputs.push(await this.ingestOne(output.path, io));
            } catch {
              // Output file no longer on disk — skip honestly.
            }
          }
        }
        if (outputs.length === 0) throw new Error("conversation has no ingestible task outputs");
        return outputs;
      }
    }
  }

  private async ingestOne(
    path: string,
    io: KnowledgeIoPort,
  ): Promise<{ location: string; title: string; text: string }> {
    const raw = isPdfPath(path)
      ? { base64: await io.readFileBase64(path) }
      : { text: await io.readTextFile(path) };
    if (raw.text !== undefined && raw.text.length > MAX_INGEST_FILE_BYTES) {
      throw new Error(`file exceeds ingestion cap (${MAX_INGEST_FILE_BYTES} chars)`);
    }
    const extracted = await extractContent(path, raw);
    if (extracted.text.trim().length === 0) throw new Error("no extractable text");
    return { location: path, title: extracted.title || path, text: extracted.text };
  }

  // --- queries -----------------------------------------------------------------

  async baseStats(): Promise<Map<string, { docCount: number; chunkCount: number }>> {
    const sources = await this.storage.readAll<KnowledgeSourceRecord>("knowledge_sources");
    const stats = new Map<string, { docCount: number; chunkCount: number }>();
    for (const source of sources) {
      const entry = stats.get(source.baseId) ?? { docCount: 0, chunkCount: 0 };
      entry.docCount += source.docCount;
      entry.chunkCount += source.chunkCount;
      stats.set(source.baseId, entry);
    }
    return stats;
  }
}
