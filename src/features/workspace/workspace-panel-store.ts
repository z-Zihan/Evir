import { create } from "zustand";
import { workspaceResourceKey, type WorkspaceResource } from "./resource-model";
import { logger } from "../../core/logging/logger";

/**
 * UI state for the workspace panel. Deliberately separate from agent/domain
 * state: panel layout or the pinned resource must never leak into run records.
 */

export type WorkspaceTab = "outputs" | "changes" | "files" | "preview" | "browser";

/**
 * Column width constants (min/default/viewport caps) moved to
 * `src/app/shell-layout.ts` alongside the resizable shell; the store no
 * longer tracks the panel width — react-resizable-panels owns it.
 */

interface ConversationPanelSnapshot {
  open: boolean;
  activeTab: WorkspaceTab;
  activeResource: WorkspaceResource | null;
  viewMode: "code" | "preview";
  pinnedKey: string | null;
  history: WorkspaceResource[];
  historyIndex: number;
  changesBadge: number;
}

interface WorkspacePanelState {
  open: boolean;
  activeTab: WorkspaceTab;
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
  /**
   * Run changes that landed while the user was locked onto another context
   * (preview/browser or a closed panel). §29: changes auto-switch only when
   * nothing user-chosen holds the focus; otherwise they accrue here as a
   * badge until the user opens the changes tab.
   */
  changesBadge: number;
  conversationSnapshots: Record<string, ConversationPanelSnapshot>;

  openPanel: (tab?: WorkspaceTab) => void;
  closePanel: () => void;
  togglePanel: (tab?: WorkspaceTab) => void;
  setTab: (tab: WorkspaceTab) => void;

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
  /** New run changes landed (total count); applies §29 auto-switch rules. */
  noteRunChanges: (count: number) => void;
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
    changesBadge: state.changesBadge,
  };
}

export const useWorkspacePanelStore = create<WorkspacePanelState>((set, get) => ({
  open: false,
  activeTab: "outputs",
  viewMode: "preview",
  activeResource: null,
  history: [],
  historyIndex: -1,
  pinnedKey: null,
  overlayBlockers: null,
  browserContextUrl: null,
  changesBadge: 0,
  conversationSnapshots: {},

  openPanel: (tab) => {
    set((state) => ({ open: true, ...(tab && tab !== state.activeTab ? { activeTab: tab } : {}) }));
    logger.info("workspace", "panel.open", { tab: get().activeTab });
  },
  closePanel: () => {
    set({ open: false });
    logger.info("workspace", "panel.close", { activeTab: get().activeTab });
  },
  togglePanel: (tab) => {
    const state = get();
    if (state.open && (!tab || tab === state.activeTab)) {
      set({ open: false });
      logger.info("workspace", "panel.close", { activeTab: state.activeTab });
      return;
    }
    set({ open: true, ...(tab ? { activeTab: tab } : {}) });
    logger.info("workspace", "panel.open", { tab: get().activeTab });
  },
  setTab: (tab) => {
    if (get().activeTab !== tab) logger.info("workspace", "panel.tab", { tab });
    set(tab === "changes" ? { activeTab: tab, changesBadge: 0 } : { activeTab: tab });
  },

  openResource: (resource, options) => {
    set((state) => {
      const key = workspaceResourceKey(resource);
      // Re-opening the current resource only refreshes it (no history spam).
      const current = state.historyIndex >= 0 ? state.history[state.historyIndex] : undefined;
      const history =
        current && workspaceResourceKey(current) === key
          ? state.history
          : [...state.history.slice(0, state.historyIndex + 1), resource].slice(-50);
      logger.info("workspace", "panel.resource-open", {
        kind: resource.kind,
        key,
        viewMode: options?.viewMode ?? "preview",
      });
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
  noteRunChanges: (count) =>
    set((state) => {
      // Closed panel never pops open on its own; the count lands as a badge.
      if (!state.open) return { changesBadge: count };
      // Outputs/files are not user-locked contexts — changes take over (§29).
      if (state.activeTab === "outputs" || state.activeTab === "files") {
        return { activeTab: "changes", changesBadge: 0 };
      }
      // Preview/browser while a run mutates files: never steal the focus,
      // accrue a badge instead.
      return { changesBadge: count };
    }),
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
