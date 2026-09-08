// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "../../core/memory/memory-repository";
import type { InstalledSkill } from "../../core/skills/types";
import { db } from "../../core/storage/db";
import { IndexedDBAdapter } from "../../core/storage/indexed-db-adapter";
import { createRuntime } from "../create-runtime";

describe("built-in Harness middleware components", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("assembles ordered middleware with Tool Policy protected by the host", () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");
    const runtime = createRuntime();
    const middleware = runtime.harnessMiddlewareRegistry?.inspect() ?? [];

    expect(middleware.map(({ id }) => id)).toEqual([
      "input-normalization",
      "mode-policy",
      "capability-gate",
      "context-budget",
      "skill-routing",
      "memory-retrieval",
      "knowledge-retrieval",
      "tool-policy",
      "loop-detection",
      "checkpoint",
      "verification",
      "observability",
    ]);
    expect(middleware.find(({ id }) => id === "tool-policy")).toMatchObject({
      ownerId: "evir.host.tool-policy",
      protected: true,
    });
  });

  it("can disable a removable middleware without disabling the remaining Harness", () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");
    const runtime = createRuntime({
      componentConfiguration: {
        "evir.harness.observability": { enabled: false },
      },
    });

    expect(
      runtime.harnessMiddlewareRegistry?.inspect().some(({ id }) => id === "observability"),
    ).toBe(false);
    expect(
      runtime.harnessMiddlewareRegistry?.inspect().some(({ id }) => id === "verification"),
    ).toBe(true);
    expect(runtime.toolRegistry?.get("read_file")).toBeDefined();
  });

  it("uses safe no-op fallbacks when Context, Skill, and Memory middleware are disabled", async () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");
    const runtime = createRuntime({
      componentConfiguration: {
        "evir.harness.context-budget": { enabled: false },
        "evir.harness.skill-routing": { enabled: false },
        "evir.harness.memory-retrieval": { enabled: false },
      },
    });
    const harness = runtime.harnessMiddlewareRegistry;
    expect(harness).toBeDefined();
    if (!harness) return;

    const budget = await harness.dispatch({
      type: "context-budget",
      conversationId: "conversation-1",
      modelId: "model-1",
      maxContextTokens: 1_000,
      estimatedInputTokens: 900,
    });
    expect(budget.snapshot).toBeUndefined();

    const routing = await harness.dispatch({
      type: "skill-routing",
      conversationId: "conversation-1",
      mode: "agent",
      userInput: "review this code",
      skills: [],
      enabledSkillIds: new Set(),
      matchedSkillIds: [],
      matchReasons: {},
    });
    expect(routing.matchedSkillIds).toEqual([]);

    const storage = new IndexedDBAdapter();
    await new MemoryRepository(storage).create({
      type: "long-term",
      scope: "global",
      key: "language",
      content: "Prefer Chinese",
    });
    const memory = await harness.dispatch({
      type: "memory-retrieval",
      conversationId: "conversation-1",
      storage,
      workspacePath: null,
      query: "language",
      maxCharacters: 1_000,
      context: "",
      memories: [],
      memoryIds: [],
    });
    expect(memory).toMatchObject({ context: "", memories: [], memoryIds: [] });
  });

  it("normalizes request mode and blocks Agent without Tool Calling", async () => {
    vi.stubEnv("VITE_EVIR_TARGET", "web");
    const runtime = createRuntime();
    const result = await runtime.harnessMiddlewareRegistry?.dispatch({
      type: "request",
      conversationId: "conversation-1",
      target: "web",
      requestedMode: "agent",
      effectiveMode: "agent",
      providerToolCalling: false,
      userInput: "  hello\r\nworld  ",
      normalizedInput: "",
      blocked: false,
    });

    expect(result).toMatchObject({
      effectiveMode: "ask",
      normalizedInput: "hello\nworld",
      blocked: false,
    });
  });

  it("keeps Tool Policy active when component configuration names a fake replacement", () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");
    const runtime = createRuntime({
      componentConfiguration: {
        "evir.harness.tool-policy": { enabled: false },
      },
    });

    expect(
      runtime.harnessMiddlewareRegistry?.inspect().find(({ id }) => id === "tool-policy"),
    ).toMatchObject({ protected: true });
  });

  it("runs context, Skill, Memory, Checkpoint, and Verification middleware", async () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");
    const runtime = createRuntime();
    const harness = runtime.harnessMiddlewareRegistry;
    expect(harness).toBeDefined();
    if (!harness) return;

    const budget = await harness.dispatch({
      type: "context-budget",
      conversationId: "conversation-1",
      modelId: "model-1",
      maxContextTokens: 1_000,
      estimatedInputTokens: 700,
    });
    expect(budget.snapshot?.compressionStage).toBe("checkpoint-compaction");

    const skill: InstalledSkill = {
      rootPath: "/skills/review",
      builtIn: true,
      manifest: {
        schemaVersion: 1,
        id: "review",
        name: "Review",
        version: "1.0.0",
        description: "Review code",
        entry: "SKILL.md",
        source: "builtin",
        capabilities: [],
        optionalCapabilities: [],
        optionalMcpServers: [],
        riskLevel: "low",
        triggers: ["review"],
      },
    };
    const routing = await harness.dispatch({
      type: "skill-routing",
      conversationId: "conversation-1",
      mode: "ask",
      userInput: "review this code",
      skills: [skill],
      enabledSkillIds: new Set(["review"]),
      matchedSkillIds: [],
      matchReasons: {},
    });
    expect(routing.matchedSkillIds).toEqual(["review"]);

    const storage = new IndexedDBAdapter();
    await new MemoryRepository(storage).create({
      type: "long-term",
      scope: "global",
      key: "language",
      content: "Prefer Chinese",
    });
    const memory = await harness.dispatch({
      type: "memory-retrieval",
      conversationId: "conversation-1",
      storage,
      workspacePath: null,
      query: "language",
      maxCharacters: 1_000,
      context: "",
      memories: [],
      memoryIds: [],
    });
    expect(memory.context).toContain("Prefer Chinese");

    // Knowledge retrieval shares the same dispatch pattern (§60): seeded
    // base/source/chunks come back as provenance-lined context.
    await storage.write("knowledge_bases", "kb-1", {
      id: "kb-1",
      name: "Docs",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await storage.write("knowledge_sources", "src-1", {
      id: "src-1",
      baseId: "kb-1",
      type: "local-file",
      title: "architecture.md",
      ref: "/ws/architecture.md",
      enabled: true,
      status: "ready",
      docCount: 1,
      chunkCount: 1,
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
    await storage.write("knowledge_chunks", "doc-1:0", {
      id: "doc-1:0",
      documentId: "doc-1",
      sourceId: "src-1",
      baseId: "kb-1",
      ordinal: 0,
      text: "The deployment pipeline uses blue-green rollout.",
      heading: "Deployment",
      updatedAt: 1,
    });
    const knowledge = await harness.dispatch({
      type: "knowledge-retrieval",
      conversationId: "conversation-1",
      storage,
      workspacePath: null,
      query: "deployment pipeline",
      baseIds: ["kb-1"],
      maxCharacters: 2_000,
      context: "",
      sourceCount: 0,
      chunkCount: 0,
    });
    expect(knowledge.context).toContain("blue-green");
    expect(knowledge.context).toContain("/ws/architecture.md");
    expect(knowledge.chunkCount).toBe(1);
    expect(knowledge.sourceCount).toBe(1);

    const persistCheckpoint = vi.fn(() => Promise.resolve());
    const checkpoint = await harness.dispatch({
      type: "checkpoint",
      conversationId: "conversation-1",
      privateSession: false,
      compressionStage: "checkpoint-compaction",
      messages: [],
      objective: "Finish task",
      mode: "agent",
      relevantMemoryIds: memory.memoryIds,
      persistCheckpoint,
      persisted: false,
    });
    expect(persistCheckpoint).toHaveBeenCalledOnce();
    expect(checkpoint.persisted).toBe(true);

    const completion = await harness.dispatch({
      type: "completion",
      conversationId: "conversation-1",
      runId: "run-1",
      toolResults: [
        {
          toolCallId: "call-1",
          toolName: "run_command",
          success: true,
          output: "tests passed",
        },
      ],
      modelClaimsComplete: true,
      verificationEvidence: [],
    });
    expect(completion.resolution).toMatchObject({ complete: true });
  });

  it("enforces protected Tool Policy when removable Middleware is disabled", async () => {
    vi.stubEnv("VITE_EVIR_TARGET", "desktop");
    const runtime = createRuntime({
      componentConfiguration: {
        "evir.harness.loop-detection": { enabled: false },
        "evir.harness.verification": { enabled: false },
      },
    });
    const result = await runtime.harnessMiddlewareRegistry?.dispatch({
      type: "tool-call",
      conversationId: "conversation-1",
      runId: "run-1",
      phase: "before-execute",
      mode: "agent",
      toolName: "unknown_tool",
      arguments: {},
      allowedToolIds: new Set(["read_file"]),
      blocked: false,
    });

    expect(result).toMatchObject({ blocked: true, blockReason: "tool-not-allowed" });
    expect(runtime.toolRegistry?.get("read_file")).toBeDefined();
  });
});
