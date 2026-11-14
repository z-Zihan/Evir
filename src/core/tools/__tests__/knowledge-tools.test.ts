// Branch coverage for the knowledge tool (search_knowledge): zod matrix,
// project resolution by workspace root, honest no-result, and excerpt
// formatting. The retriever is mocked — these tests pin the tool boundary,
// not the keyword scorer (covered by knowledge tests elsewhere).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }));

vi.mock("../../../core/knowledge/retrieval", () => ({
  defaultKnowledgeRetriever: { retrieve },
}));

import { KNOWLEDGE_TOOLS } from "../builtin/knowledge-tools";
import type { RetrievedKnowledge } from "../../../core/knowledge/types";
import type { EvirRuntime } from "../../../runtime/types";

const tool = (id: string) => KNOWLEDGE_TOOLS.find((t) => t.id === id)!;

const project = (canonicalRootPath: string, knowledgeBaseIds?: string[]) => ({
  id: "p1",
  displayName: "Project",
  nameIsCustom: false,
  rootPath: canonicalRootPath,
  canonicalRootPath,
  permissionProfile: "workspace",
  additionalAccessRoots: [],
  ...(knowledgeBaseIds ? { knowledgeBaseIds } : {}),
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: 0,
});

const runtime = (storage?: Record<string, unknown>, workspaceRoot?: string): EvirRuntime =>
  ({
    ...(workspaceRoot === undefined ? {} : { getWorkspaceRoot: () => workspaceRoot }),
    ...(storage ? { structuredStorage: storage } : {}),
  }) as unknown as EvirRuntime;

const projectStorage = (...projects: unknown[]) => ({
  readAll: vi.fn(() => Promise.resolve(projects)),
});

const hit = (overrides: {
  text: string;
  heading?: string;
  documentTitle?: string;
  location?: string;
}): RetrievedKnowledge => ({
  chunk: {
    id: "chunk-1",
    documentId: "doc-1",
    sourceId: "src-1",
    baseId: "kb-1",
    ordinal: 0,
    text: overrides.text,
    ...(overrides.heading === undefined ? {} : { heading: overrides.heading }),
    updatedAt: 0,
  },
  documentTitle: overrides.documentTitle ?? "Design Doc",
  location: overrides.location ?? "p. 3",
  sourceTitle: "design.md",
  score: 2,
});

const withHits = (...hits: RetrievedKnowledge[]) => ({
  results: hits,
  context: "",
  noResult: false,
});

beforeEach(() => {
  retrieve.mockReset();
});

describe("search_knowledge argument validation", () => {
  it.each([
    [{}, "Invalid input: expected string, received undefined"],
    [{ query: "" }, "Too small: expected string to have >=1 characters"],
    [{ query: "q".repeat(2_001) }, "Too big: expected string to have <=2000 characters"],
    [{ query: "auth", limit: 0 }, "Too small: expected number to be >=1"],
    [{ query: "auth", limit: 21 }, "Too big: expected number to be <=20"],
    [{ query: "auth", limit: 1.5 }, "Invalid input: expected int, received number"],
  ])("rejects %j with the first zod issue", async (args, output) => {
    const result = await tool("search_knowledge").execute(args, runtime());
    expect(result).toEqual({ success: false, output });
    // Validation failures carry no error code, unlike the local file tools.
    expect("error" in result).toBe(false);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects unknown keys to match the additionalProperties: false JSON schema", async () => {
    const storage = projectStorage(project("/tmp/project", ["kb-1"]));
    const result = await tool("search_knowledge").execute(
      { query: "auth", rogue: "extra" },
      runtime(storage, "/tmp/project"),
    );
    expect(result).toEqual({ success: false, output: 'Unrecognized key: "rogue"' });
    expect("error" in result).toBe(false);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("accepts arguments without unknown keys", async () => {
    retrieve.mockResolvedValue(withHits());
    const storage = projectStorage(project("/tmp/project", ["kb-1"]));
    const result = await tool("search_knowledge").execute(
      { query: "auth", limit: 5 },
      runtime(storage, "/tmp/project"),
    );
    expect(result.success).toBe(true);
    expect(retrieve).toHaveBeenCalledWith(storage, expect.objectContaining({ query: "auth" }));
  });
});

describe("search_knowledge target and project boundaries", () => {
  it("reports an unavailable index when structuredStorage is missing", async () => {
    const result = await tool("search_knowledge").execute({ query: "auth" }, runtime());
    expect(result).toEqual({
      success: false,
      output: "knowledge index unavailable on this target",
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("reports no attached bases without a workspace root", async () => {
    const storage = projectStorage();
    const result = await tool("search_knowledge").execute(
      { query: "auth" },
      runtime(storage, undefined),
    );
    expect(storage.readAll).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      output: "no knowledge bases are attached to this project",
    });
  });

  it("reports no attached bases when no project matches the root", async () => {
    const storage = projectStorage(project("/tmp/other", ["kb-1"]));
    const result = await tool("search_knowledge").execute(
      { query: "auth" },
      runtime(storage, "/tmp/project"),
    );
    expect(result).toEqual({
      success: true,
      output: "no knowledge bases are attached to this project",
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("reports no attached bases for an empty knowledgeBaseIds list", async () => {
    const storage = projectStorage(project("/tmp/project", []));
    const result = await tool("search_knowledge").execute(
      { query: "auth" },
      runtime(storage, "/tmp/project"),
    );
    expect(result).toEqual({
      success: true,
      output: "no knowledge bases are attached to this project",
    });
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe("search_knowledge retrieval", () => {
  it("answers honestly when nothing clears the relevance bar", async () => {
    retrieve.mockResolvedValue({ results: [], context: "", noResult: true });
    const storage = projectStorage(project("/tmp/project", ["kb-1", "kb-2"]));
    const result = await tool("search_knowledge").execute(
      { query: "quantum fluff" },
      runtime(storage, "/tmp/project"),
    );
    expect(result).toEqual({
      success: true,
      output:
        "no matching knowledge in the attached knowledge bases — say so plainly; do not invent knowledge-base content",
    });
  });

  it("treats empty results without the noResult flag the same way", async () => {
    retrieve.mockResolvedValue({ results: [], context: "", noResult: false });
    const storage = projectStorage(project("/tmp/project", ["kb-1"]));
    const result = await tool("search_knowledge").execute(
      { query: "auth" },
      runtime(storage, "/tmp/project"),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("no matching knowledge");
  });

  it("formats excerpts with title, heading and location", async () => {
    retrieve.mockResolvedValue(
      withHits(
        hit({ text: "first excerpt", heading: "Architecture", documentTitle: "Design Doc" }),
        hit({ text: "second excerpt", documentTitle: "Notes", location: "notes.txt ¶7" }),
      ),
    );
    const storage = projectStorage(project("/tmp/project", ["kb-1"]));
    const result = await tool("search_knowledge").execute(
      { query: "architecture" },
      runtime(storage, "/tmp/project"),
    );
    expect(result).toEqual({
      success: true,
      output:
        "[Design Doc › Architecture | p. 3]\nfirst excerpt\n\n[Notes | notes.txt ¶7]\nsecond excerpt",
    });
  });

  it("caps each excerpt at 800 characters", async () => {
    retrieve.mockResolvedValue(withHits(hit({ text: "z".repeat(900) })));
    const storage = projectStorage(project("/tmp/project", ["kb-1"]));
    const result = await tool("search_knowledge").execute(
      { query: "architecture" },
      runtime(storage, "/tmp/project"),
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe(`[Design Doc | p. 3]\n${"z".repeat(800)}`);
  });

  it("forwards baseIds, default limit 8 and the render budget", async () => {
    retrieve.mockResolvedValue(withHits());
    const storage = projectStorage(project("/tmp/project", ["kb-1", "kb-2"]));
    await tool("search_knowledge").execute(
      { query: "architecture" },
      runtime(storage, "/tmp/project"),
    );
    expect(retrieve).toHaveBeenCalledWith(storage, {
      baseIds: ["kb-1", "kb-2"],
      query: "architecture",
      limit: 8,
      maxCharacters: 6_000,
    });
  });

  it("forwards an explicit limit", async () => {
    retrieve.mockResolvedValue(withHits());
    const storage = projectStorage(project("/tmp/project", ["kb-1"]));
    await tool("search_knowledge").execute(
      { query: "architecture", limit: 3 },
      runtime(storage, "/tmp/project"),
    );
    expect(retrieve).toHaveBeenCalledWith(storage, expect.objectContaining({ limit: 3 }));
  });
});
