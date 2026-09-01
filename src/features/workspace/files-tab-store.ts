import { create } from "zustand";
import type { FileInfo } from "../../runtime/desktop-storage-adapter";
import { listDirectory, searchProjectFiles } from "./workspace-services";

/**
 * File-tree state kept outside the component so switching workspace tabs
 * never loses expansion or cache. Directories load lazily (§61) and
 * invalidate when agent mutations touch them.
 */

interface FilesTabState {
  root: string | null;
  expandedDirs: Record<string, boolean>;
  dirCache: Record<string, { entries: FileInfo[]; loadedAt: number }>;
  loadingDirs: Record<string, boolean>;
  /** repo-relative path → git status letter (M/A/D/R/?). */
  gitStatus: Record<string, string>;
  gitBranch: string | null;
  isRepo: boolean;
  search: string;
  searchResults: string[] | null;
  searching: boolean;
  error: string | null;

  bindRoot: (root: string | null) => void;
  toggleDir: (path: string) => void;
  ensureDir: (path: string) => Promise<void>;
  invalidatePath: (path: string) => void;
  refreshGitStatus: (root: string) => Promise<void>;
  setSearch: (value: string) => void;
  runSearch: (root: string) => Promise<void>;
  reloadDir: (path: string) => Promise<void>;
}

function parentDir(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? null : normalized.slice(0, index);
}

export const useFilesTabStore = create<FilesTabState>((set, get) => ({
  root: null,
  expandedDirs: {},
  dirCache: {},
  loadingDirs: {},
  gitStatus: {},
  gitBranch: null,
  isRepo: false,
  search: "",
  searchResults: null,
  searching: false,
  error: null,

  bindRoot: (root) => {
    if (get().root === root) return;
    set({
      root,
      expandedDirs: {},
      dirCache: {},
      loadingDirs: {},
      gitStatus: {},
      gitBranch: null,
      isRepo: false,
      search: "",
      searchResults: null,
      error: null,
    });
    if (root) {
      void get().ensureDir(root);
      void get().refreshGitStatus(root);
    }
  },
  toggleDir: (path) => {
    const expanded = !get().expandedDirs[path];
    set((state) => ({ expandedDirs: { ...state.expandedDirs, [path]: expanded } }));
    if (expanded) void get().ensureDir(path);
  },
  ensureDir: async (path) => {
    const state = get();
    if (state.loadingDirs[path]) return;
    const cached = state.dirCache[path];
    if (cached && Date.now() - cached.loadedAt < 15_000) return;
    set((current) => ({ loadingDirs: { ...current.loadingDirs, [path]: true } }));
    try {
      const entries = await listDirectory(path);
      set((current) => ({
        dirCache: { ...current.dirCache, [path]: { entries, loadedAt: Date.now() } },
        loadingDirs: { ...current.loadingDirs, [path]: false },
        error: null,
      }));
    } catch (error) {
      set((current) => ({
        loadingDirs: { ...current.loadingDirs, [path]: false },
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },
  invalidatePath: (path) => {
    // Reload the containing directory when it is expanded; the tree must
    // show agent-created files immediately (§12).
    const parent = parentDir(path) ?? path;
    set((state) => {
      const nextCache = { ...state.dirCache };
      delete nextCache[parent];
      return { dirCache: nextCache };
    });
    if (get().expandedDirs[parent] || parent === get().root) void get().ensureDir(parent);
  },
  refreshGitStatus: async (root) => {
    try {
      const { gitStatusFor } = await import("./workspace-services");
      const status = await gitStatusFor(root);
      const map: Record<string, string> = {};
      for (const entry of status.entries) {
        const existing = map[entry.file];
        const letter = entry.status.includes("R")
          ? "R"
          : entry.status.includes("D")
            ? "D"
            : entry.status.includes("A")
              ? "A"
              : entry.status.includes("?")
                ? "?"
                : "M";
        map[entry.file] = existing && existing !== letter ? `${existing}${letter}` : letter;
      }
      set({ gitStatus: map, gitBranch: status.branch, isRepo: status.is_repo });
    } catch {
      set({ gitStatus: {}, gitBranch: null, isRepo: false });
    }
  },
  setSearch: (value) => set({ search: value, ...(value === "" ? { searchResults: null } : {}) }),
  runSearch: async (root) => {
    const query = get().search.trim();
    if (!query) return;
    set({ searching: true });
    try {
      const results = await searchProjectFiles(root, query);
      set({ searchResults: results.slice(0, 200), searching: false });
    } catch {
      set({ searchResults: [], searching: false });
    }
  },
  reloadDir: async (path) => {
    set((state) => {
      const nextCache = { ...state.dirCache };
      delete nextCache[path];
      return { dirCache: nextCache };
    });
    await get().ensureDir(path);
  },
}));
