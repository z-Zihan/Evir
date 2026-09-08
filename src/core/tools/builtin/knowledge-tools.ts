/**
 * Knowledge Base agent tool (§60/§71): lets the model actively search the
 * knowledge bases attached to the current project. Read-only (L1 — usable
 * in plan mode), reads the entity index (no filesystem capability), and
 * reports an honest "no matching knowledge" when nothing clears the
 * relevance bar instead of fabricating content.
 */
import { z } from "zod";
import { defaultKnowledgeRetriever } from "../../knowledge/retrieval";
import type { ProjectRecord } from "../../storage/db";
import type { EvirRuntime } from "../../../runtime/types";
import type { ToolDefinition } from "../../providers/tool-registry";

const searchArgsSchema = z.object({
  query: z.string().min(1).max(2_000),
  limit: z.number().int().min(1).max(20).optional(),
});

async function searchKnowledge(
  args: Record<string, unknown>,
  runtime: EvirRuntime,
): Promise<{ success: boolean; output: string }> {
  const parsed = searchArgsSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, output: parsed.error.issues[0]?.message ?? "invalid arguments" };
  }
  const storage = runtime.structuredStorage;
  if (!storage) return { success: false, output: "knowledge index unavailable on this target" };
  // Resolve the project by its workspace root — the run's permission context
  // binds tools to one root, so this matches exactly the project in play.
  const workspaceRoot = runtime.getWorkspaceRoot?.() ?? null;
  const projects = workspaceRoot
    ? (await storage.readAll<ProjectRecord>("projects")).filter(
        (project) => project.canonicalRootPath === workspaceRoot,
      )
    : [];
  const baseIds = projects[0]?.knowledgeBaseIds ?? [];
  if (baseIds.length === 0) {
    return { success: true, output: "no knowledge bases are attached to this project" };
  }
  const result = await defaultKnowledgeRetriever.retrieve(storage, {
    baseIds,
    query: parsed.data.query,
    limit: parsed.data.limit ?? 8,
    maxCharacters: 6_000,
  });
  if (result.noResult || result.results.length === 0) {
    return {
      success: true,
      output:
        "no matching knowledge in the attached knowledge bases — say so plainly; do not invent knowledge-base content",
    };
  }
  const lines = result.results.map(
    (hit) =>
      `[${hit.documentTitle}${hit.chunk.heading ? ` › ${hit.chunk.heading}` : ""} | ${hit.location}]\n${hit.chunk.text.slice(0, 800)}`,
  );
  return { success: true, output: lines.join("\n\n") };
}

export const KNOWLEDGE_TOOLS: readonly ToolDefinition[] = [
  {
    id: "search_knowledge",
    name: "search_knowledge",
    description:
      "Search the knowledge bases attached to this project (local documents, web pages, task outputs indexed by the user). Returns excerpts with source locations. Returns 'no matching knowledge' honestly when the bases do not cover the query.",
    source: "evir-local",
    riskLevel: "L1",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for in the knowledge bases" },
        limit: { type: "number", description: "Max excerpts to return (default 8)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: (args, runtime) => searchKnowledge(args, runtime),
  },
] as const;
