import { create } from "zustand";

const STORAGE_KEY = "evir-workspace";
const CURRENT_STORAGE_KEY = "evir-workspace-current";

interface WorkspaceState {
  currentWorkspace: string | null;
  recentWorkspaces: string[];
  setWorkspace: (path: string) => void;
  clearWorkspace: () => void;
  loadWorkspace: () => void;
}

function loadRecent(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(paths: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

function loadCurrent(): string | null {
  const stored = localStorage.getItem(CURRENT_STORAGE_KEY);
  return stored && stored.trim() ? stored : null;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspace: null,
  recentWorkspaces: loadRecent(),
  setWorkspace: (path) => {
    set((state) => {
      const recent = [path, ...state.recentWorkspaces.filter((p) => p !== path)].slice(0, 10);
      saveRecent(recent);
      localStorage.setItem(CURRENT_STORAGE_KEY, path);
      return { currentWorkspace: path, recentWorkspaces: recent };
    });
  },
  clearWorkspace: () => {
    localStorage.removeItem(CURRENT_STORAGE_KEY);
    set({ currentWorkspace: null });
  },
  loadWorkspace: () => {
    const recent = loadRecent();
    const current = loadCurrent();
    set({
      recentWorkspaces: recent,
      currentWorkspace: current && recent.includes(current) ? current : null,
    });
  },
}));
