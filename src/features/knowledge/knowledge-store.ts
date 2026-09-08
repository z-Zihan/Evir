/**
 * Knowledge store (UI state): zustand store over KnowledgeRepository. All
 * mutations run through the repository so the permission checks and index
 * bookkeeping stay in one place; the store only mirrors results.
 */
import { create } from "zustand";
import { KnowledgeRepository } from "../../core/knowledge/knowledge-repository";
import type { KnowledgeSourceRecord, KnowledgeSourceType } from "../../core/knowledge/types";
import { getStructuredStorage } from "../../runtime/structured-storage";
import { getRuntime } from "../../runtime/use-runtime";
import { logger } from "../../core/logging/logger";

export interface KnowledgeBaseView {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  docCount: number;
  chunkCount: number;
  sourceCount: number;
}

interface KnowledgeState {
  bases: KnowledgeBaseView[];
  sourcesByBase: Record<string, KnowledgeSourceRecord[]>;
  loading: boolean;
  busy: boolean;
  load: () => Promise<void>;
  createBase: (name: string, description?: string) => Promise<KnowledgeBaseView | null>;
  renameBase: (id: string, name: string) => Promise<void>;
  setBaseEnabled: (id: string, enabled: boolean) => Promise<void>;
  deleteBase: (id: string) => Promise<void>;
  addSource: (input: {
    baseId: string;
    type: KnowledgeSourceType;
    title: string;
    ref: string;
    permissionRoots?: { workspaceRoot: string | null; additionalRoots: string[] };
    autoReindex?: boolean;
  }) => Promise<KnowledgeSourceRecord | { error: string }>;
  setSourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  reindexSource: (
    id: string,
    permissionRoots?: { workspaceRoot: string | null; additionalRoots: string[] },
  ) => Promise<void>;
}

function repository(): KnowledgeRepository {
  return new KnowledgeRepository(getStructuredStorage());
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  bases: [],
  sourcesByBase: {},
  loading: false,
  busy: false,

  load: async () => {
    set({ loading: true });
    try {
      const repo = repository();
      const [bases, sources, stats] = await Promise.all([
        repo.listBases(),
        repo.listSources(),
        repo.baseStats(),
      ]);
      const sourcesByBase: Record<string, KnowledgeSourceRecord[]> = {};
      for (const source of sources) {
        sourcesByBase[source.baseId] = [...(sourcesByBase[source.baseId] ?? []), source];
      }
      set({
        bases: bases.map((base) => ({
          id: base.id,
          name: base.name,
          ...(base.description ? { description: base.description } : {}),
          enabled: base.enabled,
          docCount: stats.get(base.id)?.docCount ?? 0,
          chunkCount: stats.get(base.id)?.chunkCount ?? 0,
          sourceCount: sourcesByBase[base.id]?.length ?? 0,
        })),
        sourcesByBase,
      });
    } catch (error) {
      // Knowledge UI must never break on storage failures — empty state wins.
      logger.warn("knowledge", "knowledge.load-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      set({ bases: [], sourcesByBase: {} });
    } finally {
      set({ loading: false });
    }
  },

  createBase: async (name, description) => {
    set({ busy: true });
    try {
      await repository().createBase({ name, ...(description ? { description } : {}) });
      await get().load();
      return get().bases.find((base) => base.name === name) ?? null;
    } finally {
      set({ busy: false });
    }
  },

  renameBase: async (id, name) => {
    set({ busy: true });
    try {
      await repository().updateBase(id, { name });
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  setBaseEnabled: async (id, enabled) => {
    await repository().updateBase(id, { enabled });
    await get().load();
  },

  deleteBase: async (id) => {
    set({ busy: true });
    try {
      await repository().deleteBase(id);
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  addSource: async (input) => {
    set({ busy: true });
    try {
      const source = await repository().createSource(input);
      if (input.autoReindex !== false) {
        const roots = input.permissionRoots ?? { workspaceRoot: null, additionalRoots: [] };
        await repository().reindexSource(source, await ioForRoots(roots), {
          permissionRoots: roots,
        });
      }
      await get().load();
      const refreshed = get().sourcesByBase[input.baseId]?.find((item) => item.id === source.id);
      return refreshed ?? source;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("knowledge", "knowledge.source-add-failed", { error: message });
      return { error: message };
    } finally {
      set({ busy: false });
    }
  },

  setSourceEnabled: async (id, enabled) => {
    await repository().updateSource(id, { enabled });
    await get().load();
  },

  removeSource: async (id) => {
    set({ busy: true });
    try {
      await repository().deleteSource(id);
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  reindexSource: async (id, permissionRoots) => {
    set({ busy: true });
    try {
      const sources = Object.values(get().sourcesByBase).flat();
      const source = sources.find((item) => item.id === id);
      if (!source) return;
      const roots = permissionRoots ?? { workspaceRoot: null, additionalRoots: [] };
      await repository().reindexSource(source, await ioForRoots(roots), {
        permissionRoots: roots,
      });
      await get().load();
    } finally {
      set({ busy: false });
    }
  },
}));

async function ioForRoots(roots: {
  workspaceRoot: string | null;
  additionalRoots: string[];
}): Promise<import("../../core/knowledge/knowledge-io").KnowledgeIoPort> {
  // Web target has no fs port; local sources fail with a clear error, web
  // URL sources still work. Desktop lazily pulls the tauri-backed IO so the
  // web bundle never imports @tauri-apps/api.
  const runtime = getRuntime();
  if (runtime.target !== "desktop") {
    return {
      readTextFile: () =>
        Promise.reject(new Error("local knowledge sources require the desktop app")),
      readFileBase64: () =>
        Promise.reject(new Error("local knowledge sources require the desktop app")),
      listIngestibleFiles: () =>
        Promise.reject(new Error("local knowledge sources require the desktop app")),
      fetchText: async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`);
        return response.text();
      },
    };
  }
  const { createDesktopKnowledgeIo } = await import("./desktop-knowledge-io");
  return createDesktopKnowledgeIo(
    [roots.workspaceRoot, ...roots.additionalRoots].filter(
      (root): root is string => typeof root === "string" && root.length > 0,
    ),
  );
}
