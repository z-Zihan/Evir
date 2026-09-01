import { create } from "zustand";
import { workspaceResourceKey, type WorkspaceResource } from "./resource-model";

/**
 * UI state for the workspace panel. Deliberately separate from agent/domain
 * state: panel width or the pinned resource must never leak into run records.
 */

export type WorkspaceTab = "changes" | "files" | "preview" | "browser";

export const WORKSPACE_MIN_WIDTH = 360;
export const WORKSPACE_DEFAULT_WIDTH = 520;
export const WORKSPACE_MAX_WIDTH_RATIO = 0.7;

const WIDTH_STORAGE_KEY = "evir-workspace-width";

function clampWidth(width: number): number {
  if (typeof window !== "undefined") {
    const max = Math.max(WORKSPACE_MIN_WIDTH, window.innerWidth * WORKSPACE_MAX_WIDTH_RATIO);
    return Math.min(Math.max(width, WORKSPACE_MIN_WIDTH), Math.floor(max));
  }
  return Math.min(Math.max(width, WORKSPACE_MIN_WIDTH), 1600);
}

function loadPersistedWidth(): number {
  if (typeof window === "undefined") return WORKSPACE_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampWidth(parsed) : WORKSPACE_DEFAULT_WIDTH;
}

interface ConversationPanelSnapshot {
  open: boolean;
  activeTab: WorkspaceTab;
  activeResource: WorkspaceResource | null;
  viewMode: "code" | "preview";
  pinnedKey: string | null;
  history: WorkspaceResource[];
  historyIndex: number;
}

interface WorkspacePanelState {
  open: boolean;
  activeTab: WorkspaceTab;
  width: number;
  viewMode: "code" | "preview";
  activeResource: WorkspaceResource | null;
  history: WorkspaceResource[];
  historyIndex: number;
  pinnedKey: string | null;
  /**
   * Full-screen overlays (settings, permission dialogs, lightbox) must hide
   * the native browser content webviews rendered above the DOM. Multiple
   * overlays can stack, so blockers register by key.
   */
  overlayBlockers: Record<string, true> | null;
  /** Current URL of the workspace browser's active tab, for context chips. */
  browserContextUrl: string | null;
  conversationSnapshots: Record<string, ConversationPanelSnapshot>;

  openPanel: (tab?: WorkspaceTab) => void;
  closePanel: () => void;
  togglePanel: (tab?: WorkspaceTab) => void;
  setTab: (tab: WorkspaceTab) => void;
  setWidth: (width: number) => void;
  resetWidth: () => void;

  openResource: (resource: WorkspaceResource, options?: { viewMode?: "code" | "preview" }) => void;
  setViewMode: (mode: "code" | "preview") => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  togglePin: () => void;
  isPinned: (resource: WorkspaceResource) => boolean;

  setOverlayBlocked: (key: string, blocked: boolean) => void;
  setBrowserContextUrl: (url: string | null) => void;
  saveConversationState: (conversationId: string) => void;
  restoreConversationState: (conversationId: string) => void;
}

function currentStateSnapshot(state: WorkspacePanelState): ConversationPanelSnapshot {
  return {
    open: state.open,
    activeTab: state.activeTab,
    activeResource: state.activeResource,
    viewMode: state.viewMode,
    pinnedKey: state.pinnedKey,
    history: state.history,
    historyIndex: state.historyIndex,
  };
}

export const useWorkspacePanelStore = create<WorkspacePanelState>((set, get) => ({
  open: false,
  activeTab: "changes",
  width: loadPersistedWidth(),
  viewMode: "preview",
  activeResource: null,
  history: [],
  historyIndex: -1,
  pinnedKey: null,
  overlayBlockers: null,
  browserContextUrl: null,
  conversationSnapshots: {},

  openPanel: (tab) =>
    set((state) => ({ open: true, ...(tab && tab !== state.activeTab ? { activeTab: tab } : {}) })),
  closePanel: () => set({ open: false }),
  togglePanel: (tab) => {
    const state = get();
    if (state.open && (!tab || tab === state.activeTab)) {
      set({ open: false });
      return;
    }
    set({ open: true, ...(tab ? { activeTab: tab } : {}) });
  },
  setTab: (tab) => set({ activeTab: tab }),
  setWidth: (width) => {
    const clamped = clampWidth(width);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    }
    set({ width: clamped });
  },
  resetWidth: () => get().setWidth(WORKSPACE_DEFAULT_WIDTH),

  openResource: (resource, options) => {
    set((state) => {
      const key = workspaceResourceKey(resource);
      // Re-opening the current resource only refreshes it (no history spam).
      const current = state.historyIndex >= 0 ? state.history[state.historyIndex] : undefined;
      const history =
        current && workspaceResourceKey(current) === key
          ? state.history
          : [...state.history.slice(0, state.historyIndex + 1), resource].slice(-50);
      return {
        open: true,
        activeTab: "preview",
        activeResource: resource,
        viewMode: options?.viewMode ?? "preview",
        history,
        historyIndex: history.length - 1,
      };
    });
  },
  setViewMode: (mode) => set({ viewMode: mode }),
  canGoBack: () => get().historyIndex > 0,
  canGoForward: () => get().historyIndex < get().history.length - 1,
  goBack: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state;
      const index = state.historyIndex - 1;
      const resource = state.history[index];
      return resource
        ? { historyIndex: index, activeResource: resource, activeTab: "preview", open: true }
        : state;
    }),
  goForward: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const index = state.historyIndex + 1;
      const resource = state.history[index];
      return resource
        ? { historyIndex: index, activeResource: resource, activeTab: "preview", open: true }
        : state;
    }),
  togglePin: () =>
    set((state) => {
      if (!state.activeResource) return { pinnedKey: null };
      const key = workspaceResourceKey(state.activeResource);
      return { pinnedKey: state.pinnedKey === key ? null : key };
    }),
  isPinned: (resource) => get().pinnedKey === workspaceResourceKey(resource),

  setOverlayBlocked: (key, blocked) =>
    set((state) => {
      const next = { ...(state.overlayBlockers ?? {}) };
      if (blocked) next[key] = true;
      else delete next[key];
      return { overlayBlockers: Object.keys(next).length > 0 ? next : null };
    }),
  setBrowserContextUrl: (url) => set({ browserContextUrl: url }),
  saveConversationState: (conversationId) =>
    set((state) => ({
      conversationSnapshots: {
        ...state.conversationSnapshots,
        [conversationId]: currentStateSnapshot(state),
      },
    })),
  restoreConversationState: (conversationId) => {
    const snapshot = get().conversationSnapshots[conversationId];
    if (!snapshot) {
      // Fresh conversation: closed panel, no cross-thread resource bleed (§53).
      set({
        open: false,
        activeResource: null,
        history: [],
        historyIndex: -1,
        pinnedKey: null,
        viewMode: "preview",
      });
      return;
    }
    set({ ...snapshot });
  },
}));

/** Auto-open respect: agent-driven opens never steal a pinned resource. */
export function shouldAutoOpenResource(
  pinnedKey: string | null,
  resource: WorkspaceResource,
): boolean {
  return pinnedKey === null || pinnedKey === workspaceResourceKey(resource);
}

/** True while any full-screen overlay demands hiding native browser webviews. */
export function selectOverlayBlocked(state: WorkspacePanelState): boolean {
  return state.overlayBlockers !== null;
}
