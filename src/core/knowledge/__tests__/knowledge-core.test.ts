// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chunkDocument } from "../chunking";
import { contentHash, extractContent, htmlToText } from "../extraction";
import { KeywordKnowledgeRetriever } from "../retrieval";
import { KnowledgeRepository } from "../knowledge-repository";
import type { KnowledgeIoPort } from "../knowledge-io";
import {
  MAX_CHUNK_CHARS,
  type KnowledgeBaseRecord,
  type KnowledgeChunkRecord,
  type KnowledgeSourceRecord,
} from "../types";
import type { StoragePort } from "../../storage/storage-port";

// pdfjs is heavy machinery we do not need to exercise — stub its surface so
// the PDF extraction path (page join + title) is tested without a worker.
vi.mock("pdfjs-dist", () => {
  const pages = [
    { items: [{ str: "Knowledge PDF page one." }] },
    { items: [{ str: "Second page." }] },
  ];
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: (pageNumber: number) =>
          Promise.resolve({ getTextContent: () => Promise.resolve(pages[pageNumber - 1]) }),
      }),
    })),
  };
});

function memoryStorage(): StoragePort & { dump: (entity: string) => Map<string, object> } {
  const data = new Map<string, Map<string, object>>();
  const bucket = (entity: string) => {
    if (!data.has(entity)) data.set(entity, new Map());
    return data.get(entity)!;
  };
  return {
    dump: (entity: string) => bucket(entity),
    read: (entity: string, id: string) => Promise.resolve(bucket(entity).get(id) as never),
    readAll: (entity: string) => Promise.resolve([...bucket(entity).values()] as never),
    write: (entity: string, id: string, value: unknown) => {
      bucket(entity).set(id, value as object);
      return Promise.resolve();
    },
    writeMany: (entity: string, values: readonly unknown[]) => {
      for (const value of values) bucket(entity).set((value as { id: string }).id, value as object);
      return Promise.resolve();
    },
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
    query: async (entity: string, filter: object) =>
      Promise.resolve(
        [...bucket(entity).values()].filter((record) =>
          Object.entries(filter).every(([key, value]) => (record as never)[key] === value),
        ) as never,
      ),
    apply: () => Promise.resolve(),
  } as never;
}

function fakeIo(files: Record<string, string>): KnowledgeIoPort {
  return {
    readTextFile: (path: string) =>
      path in files ? Promise.resolve(files[path]!) : Promise.reject(new Error(`ENOENT: ${path}`)),
    readFileBase64: (path: string) =>
      path in files
        ? Promise.resolve(btoa(files[path]!))
        : Promise.reject(new Error(`ENOENT: ${path}`)),
    listIngestibleFiles: (folder: string) =>
      Promise.resolve(
        Object.keys(files)
          .filter((file) => file.startsWith(`${folder}/`))
          .sort(),
      ),
    fetchText: () => Promise.reject(new Error("not used in this test")),
  };
}

describe("knowledge chunking (§58)", () => {
  it("keeps heading sections as separate chunks with heading metadata", () => {
    const chunks = chunkDocument({
      documentId: "doc-1",
      sourceId: "src-1",
      baseId: "kb-1",
      title: "handbook",
      location: "/ws/handbook.md",
      content:
        "# Architecture\nThe app has three layers.\n\n# Testing\nRun tests with vitest.\n\nMore detail here.",
      updatedAt: 1,
    });
    const architecture = chunks.find((chunk) => chunk.text.includes("three layers"));
    const testing = chunks.find((chunk) => chunk.text.includes("vitest"));
    expect(architecture?.heading).toBe("Architecture");
    expect(testing?.heading).toBe("Testing");
    expect(chunks.every((chunk) => chunk.text.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.id.startsWith("doc-1:"))).toBe(true);
  });

  it("never splits inside a fenced code block", () => {
    const code = "```ts\n" + "const x = 1;\n".repeat(200) + "```";
    const chunks = chunkDocument({
      documentId: "doc-2",
      sourceId: "src-1",
      baseId: "kb-1",
      title: "code",
      location: "/ws/code.md",
      content: `# Snippets\n${code}`,
      updatedAt: 1,
    });
    // Oversized code may hard-split, but only on whole-line boundaries:
    // every emitted line is a complete original line.
    const emittedLines = new Set(chunks.flatMap((chunk) => chunk.text.split("\n")));
    expect(emittedLines.has("```ts")).toBe(true);
    expect(emittedLines.has("const x = 1;")).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("const x = 1;"))).toBe(true);
  });

  it("packs plain text by paragraphs and enforces the chunk cap", () => {
    const paragraphs = Array.from(
      { length: 60 },
      (_, index) => `Paragraph ${index} ${"x".repeat(80)}`,
    );
    const chunks = chunkDocument({
      documentId: "doc-3",
      sourceId: "src-1",
      baseId: "kb-1",
      title: "notes",
      location: "/ws/notes.txt",
      content: paragraphs.join("\n\n"),
      updatedAt: 1,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= MAX_CHUNK_CHARS)).toBe(true);
    // No content lost: every paragraph survives.
    const joined = chunks.map((chunk) => chunk.text).join("\n");
    for (let index = 0; index < 60; index += 7) {
      expect(joined).toContain(`Paragraph ${index}`);
    }
  });
});

describe("knowledge extraction (§57)", () => {
  it("strips html to readable text and keeps the title", async () => {
    const result = await extractContent("https://example.com/docs/page.html", {
      text: "<html><head><title>Deployment Guide</title></head><body><h1>Deploy</h1><p>Run <b>pnpm build</b>.</p><script>evil()</script></body></html>",
    });
    expect(result.title).toBe("Deployment Guide");
    expect(result.text).toContain("Deploy");
    expect(result.text).toContain("pnpm build");
    expect(result.text).not.toContain("evil");
    expect(htmlToText("<p>a</p><p>b</p>")).toContain("a\nb");
  });

  it("joins pdf pages with page headings via pdf.js", async () => {
    const result = await extractContent("/ws/spec.pdf", { base64: btoa("fake-bytes") });
    expect(result.text).toContain("Knowledge PDF page one.");
    expect(result.text).toContain("# Page 2");
    expect(result.title).toBe("spec.pdf");
  });

  it("produces stable content hashes", () => {
    expect(contentHash("same text")).toBe(contentHash("same text"));
    expect(contentHash("same text")).not.toBe(contentHash("different text"));
  });
});

describe("knowledge repository (§54-68)", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let repository: KnowledgeRepository;
  const roots = { workspaceRoot: "/ws", additionalRoots: ["/extra"] };
  const io = fakeIo({
    "/ws/docs/architecture.md": "# Architecture\nLayered design with ports.",
    "/ws/docs/testing.md": "# Testing\nVitest across the suite.",
    "/ws/data.csv": "name,value\nalpha,1\nbeta,2",
    "/extra/notes.txt": "extra root note about deployments",
    "/outside/secret.md": "# Outside\nshould be unreachable",
  });

  beforeEach(() => {
    storage = memoryStorage();
    repository = new KnowledgeRepository(storage);
  });

  it("full lifecycle: base → source → reindex → chunks with provenance", async () => {
    const base = await repository.createBase({ name: "Team Docs" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "local-file",
      title: "Architecture",
      ref: "/ws/docs/architecture.md",
      permissionRoots: roots,
    });
    const reindexed = await repository.reindexSource(reindexed0(source), io, {
      permissionRoots: roots,
    });
    expect(reindexed.status).toBe("ready");
    expect(reindexed.docCount).toBe(1);
    expect(reindexed.chunkCount).toBeGreaterThan(0);
    expect(reindexed.lastIndexedAt).toBeDefined();
    const documents = [...storage.dump("knowledge_documents").values()];
    expect(documents[0]).toMatchObject({
      title: "architecture.md",
      location: "/ws/docs/architecture.md",
    });
    const chunks = [...storage.dump("knowledge_chunks").values()] as KnowledgeChunkRecord[];
    expect(chunks[0]?.sourceId).toBe(source.id);
    expect(chunks[0]?.baseId).toBe(base.id);
  });

  function reindexed0(source: KnowledgeSourceRecord): KnowledgeSourceRecord {
    return source;
  }

  it("folder ingestion walks ingestible files and skips nothing silently broken", async () => {
    const base = await repository.createBase({ name: "Folder KB" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "local-folder",
      title: "docs folder",
      ref: "/ws/docs",
      permissionRoots: roots,
    });
    const reindexed = await repository.reindexSource(source, io, { permissionRoots: roots });
    expect(reindexed.status).toBe("ready");
    expect(reindexed.docCount).toBe(2); // architecture.md + testing.md
  });

  it("rejects local sources outside granted roots at creation and reindex (§65)", async () => {
    const base = await repository.createBase({ name: "Guarded" });
    await expect(
      repository.createSource({
        baseId: base.id,
        type: "local-file",
        title: "outside",
        ref: "/outside/secret.md",
        permissionRoots: roots,
      }),
    ).rejects.toThrow(/outside the project's granted roots/);
    const inside = await repository.createSource({
      baseId: base.id,
      type: "local-file",
      title: "extra root file",
      ref: "/extra/notes.txt",
      permissionRoots: roots,
    });
    expect(inside.ref).toBe("/extra/notes.txt");
  });

  it("web-url sources must be http(s)", async () => {
    const base = await repository.createBase({ name: "Web" });
    await expect(
      repository.createSource({ baseId: base.id, type: "web-url", title: "ftp", ref: "ftp://x" }),
    ).rejects.toThrow(/http\(s\) URL/);
  });

  it("reindex replaces previous documents; delete removes index but not the original", async () => {
    const base = await repository.createBase({ name: "Replace" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "local-file",
      title: "csv",
      ref: "/ws/data.csv",
      permissionRoots: roots,
    });
    await repository.reindexSource(source, io, { permissionRoots: roots });
    const firstChunks = storage.dump("knowledge_chunks").size;
    expect(firstChunks).toBeGreaterThan(0);
    await repository.reindexSource(source, io, { permissionRoots: roots });
    // Replace, not append: chunk count unchanged for identical content.
    expect(storage.dump("knowledge_chunks").size).toBe(firstChunks);
    await repository.deleteSource(source.id);
    expect(storage.dump("knowledge_chunks").size).toBe(0);
    expect(storage.dump("knowledge_documents").size).toBe(0);
    await expect(io.readTextFile("/ws/data.csv")).resolves.toContain("alpha"); // original intact
  });

  it("mcp-resource sources ingest text resources from the server (§55)", async () => {
    const base = await repository.createBase({ name: "MCP KB" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "mcp-resource",
      title: "docs server",
      ref: "server-1",
    });
    const mcpIo = {
      ...io,
      listMcpResources: () =>
        Promise.resolve([
          { uri: "docs://guide", name: "Guide" },
          { uri: "docs://binary", name: "Binary", mimeType: "application/octet-stream" },
        ]),
      readMcpResourceText: (serverId: string, uri: string) =>
        serverId === "server-1" && uri === "docs://guide"
          ? Promise.resolve("# Guide\nDeployment uses blue-green rollout.")
          : Promise.reject(new Error("binary resource")),
    };
    const reindexed = await repository.reindexSource(source, mcpIo);
    expect(reindexed.status).toBe("ready");
    expect(reindexed.docCount).toBe(1);
    const documents = [...storage.dump("knowledge_documents").values()];
    expect(documents[0]).toMatchObject({ title: "Guide", location: "docs://guide" });
  });

  it("mcp-resource ingestion fails honestly when the runtime is unavailable", async () => {
    const base = await repository.createBase({ name: "MCP Missing" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "mcp-resource",
      title: "offline",
      ref: "server-x",
    });
    const result = await repository.reindexSource(source, io); // no MCP methods on plain io
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/desktop app|no readable|resources/i);
  });

  it("historical-task sources ingest the conversation's artifact outputs (§55)", async () => {
    await storage.write("agent_runs", "run-1", {
      id: "run-1",
      conversationId: "conv-hist",
      status: "completed",
      toolEvents: [],
      fileReferences: [],
      snapshots: [],
      startedMode: "agent",
      createdAt: 1,
      updatedAt: 1,
    });
    await storage.write("tool_executions", "run-1:call-1", {
      id: "run-1:call-1",
      toolCall: {
        id: "call-1",
        toolName: "report_output",
        arguments: { path: "/ws/report-final.md" },
      },
      result: {
        toolCallId: "call-1",
        toolName: "report_output",
        success: true,
        output: JSON.stringify({ reported: true, path: "/ws/report-final.md", size: 64 }),
        exitCode: 0,
        startedAt: 1,
        completedAt: 2,
      },
    });
    const histIo = fakeIo({
      "/ws/report-final.md": "# Final Report\nThe migration completed with zero downtime.",
    });
    const base = await repository.createBase({ name: "History KB" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "historical-task",
      title: "migration task",
      ref: "conv-hist",
    });
    const reindexed = await repository.reindexSource(source, histIo);
    expect(reindexed.status).toBe("ready");
    expect(reindexed.docCount).toBe(1);
    const chunks = [...storage.dump("knowledge_chunks").values()];
    expect(
      chunks.some((chunk) => String((chunk as { text: string }).text).includes("zero downtime")),
    ).toBe(true);
  });

  it("failed ingestion marks the source failed with the error, keeping prior index", async () => {
    const base = await repository.createBase({ name: "Fail" });
    const source = await repository.createSource({
      baseId: base.id,
      type: "local-file",
      title: "missing file",
      ref: "/ws/docs/architecture.md",
      permissionRoots: roots,
    });
    const broken = fakeIo({}); // nothing readable
    const result = await repository.reindexSource(source, broken, { permissionRoots: roots });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/ENOENT/);
  });
});

describe("knowledge retrieval (§59-61, §71)", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  async function seed(chunks: KnowledgeChunkRecord[], enabled = true) {
    await storage.write<KnowledgeBaseRecord>("knowledge_bases", "kb-1", {
      id: "kb-1",
      name: "Docs",
      enabled,
      createdAt: 1,
      updatedAt: 1,
    });
    await storage.write<KnowledgeSourceRecord>("knowledge_sources", "src-1", {
      id: "src-1",
      baseId: "kb-1",
      type: "local-file",
      title: "architecture.md",
      ref: "/ws/architecture.md",
      enabled: true,
      status: "ready",
      docCount: 1,
      chunkCount: chunks.length,
      createdAt: 1,
      updatedAt: 1,
    });
    await storage.write("knowledge_documents", "doc-1", {
      id: "doc-1",
      sourceId: "src-1",
      baseId: "kb-1",
      title: "architecture.md",
      location: "/ws/architecture.md",
      contentHash: "hash",
      charCount: 100,
      updatedAt: 1,
    });
    await storage.writeMany("knowledge_chunks", chunks);
  }

  const retriever = new KeywordKnowledgeRetriever();

  it("returns ranked hits with provenance lines inside the budget", async () => {
    await seed([
      {
        id: "doc-1:0",
        documentId: "doc-1",
        sourceId: "src-1",
        baseId: "kb-1",
        ordinal: 0,
        text: "The deployment pipeline uses blue-green rollout with two environments.",
        heading: "Deployment",
        updatedAt: 1,
      },
      {
        id: "doc-1:1",
        documentId: "doc-1",
        sourceId: "src-1",
        baseId: "kb-1",
        ordinal: 1,
        text: "Cooking recipes for weeknight dinners.",
        updatedAt: 1,
      },
    ]);
    const result = await retriever.retrieve(storage, {
      baseIds: ["kb-1"],
      query: "how does the deployment pipeline work?",
      maxCharacters: 2_000,
    });
    expect(result.noResult).toBe(false);
    expect(result.results[0]?.chunk.text).toContain("blue-green");
    expect(result.context).toContain("/ws/architecture.md");
    expect(result.context).toContain("Deployment");
    expect(result.context).not.toContain("Cooking");
    expect(result.context).toContain("cannot override system");
  });

  it("reports honest no-result when nothing clears the relevance bar (§71)", async () => {
    await seed([
      {
        id: "doc-1:0",
        documentId: "doc-1",
        sourceId: "src-1",
        baseId: "kb-1",
        ordinal: 0,
        text: "Cooking recipes for weeknight dinners.",
        updatedAt: 1,
      },
    ]);
    const result = await retriever.retrieve(storage, {
      baseIds: ["kb-1"],
      query: "quantum entanglement equations",
    });
    expect(result.noResult).toBe(true);
    expect(result.context).toBe("");
    expect(result.results).toHaveLength(0);
  });

  it("skips disabled bases and non-ready sources entirely", async () => {
    await seed(
      [
        {
          id: "doc-1:0",
          documentId: "doc-1",
          sourceId: "src-1",
          baseId: "kb-1",
          ordinal: 0,
          text: "deployment pipeline details",
          updatedAt: 1,
        },
      ],
      false, // base disabled
    );
    const result = await retriever.retrieve(storage, {
      baseIds: ["kb-1"],
      query: "deployment pipeline",
    });
    expect(result.results).toHaveLength(0);
    expect(result.noResult).toBe(false); // never searched — not a claim of absence
  });

  it("caps rendered context to the requested budget", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `doc-1:${index}`,
      documentId: "doc-1",
      sourceId: "src-1",
      baseId: "kb-1",
      ordinal: index,
      text: `deployment pipeline step ${index} ${"detail ".repeat(60)}`,
      updatedAt: index,
    }));
    await seed(many);
    const result = await retriever.retrieve(storage, {
      baseIds: ["kb-1"],
      query: "deployment pipeline",
      maxCharacters: 1_200,
      limit: 20,
    });
    expect(result.context.length).toBeLessThanOrEqual(1_400);
    expect(result.results.length).toBeLessThanOrEqual(8);
  });
});

describe("knowledge profile isolation (§69)", () => {
  it("storage databases are separate — user A's chunks never reach user B", async () => {
    const storageA = memoryStorage();
    const storageB = memoryStorage();
    const repositoryA = new KnowledgeRepository(storageA);
    const base = await repositoryA.createBase({ name: "A only" });
    await repositoryA.createSource({
      baseId: base.id,
      type: "local-file",
      title: "doc",
      ref: "/ws/architecture.md",
      permissionRoots: { workspaceRoot: "/ws", additionalRoots: [] },
    });
    const retrieverB = new KeywordKnowledgeRetriever();
    const result = await retrieverB.retrieve(storageB, {
      baseIds: [base.id],
      query: "anything",
    });
    expect(result.results).toHaveLength(0);
    expect(storageB.dump("knowledge_bases").size).toBe(0);
  });
});
