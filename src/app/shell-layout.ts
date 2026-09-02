import type { LayoutStorage } from "react-resizable-panels";

/**
 * Shell column layout for the react-resizable-panels v4 Group in App.tsx.
 *
 * Column widths persist per visible-panel composition ("panelIds"): the
 * library stores one key per set of mounted panels, as
 * `{ panelId: percentage }` (Layout = flexGrow percentages of the Group). The
 * legacy px widths (`evir-sidebar-width`, `evir-workspace-width`) are
 * migrated lazily and write-through: the first read of a composition key
 * converts the legacy px into percentages, and the first save deletes the
 * legacy keys so they can never resurrect the old widths.
 */

/** Storage namespace for the shell Group layout (one key per composition). */
export const SHELL_LAYOUT_STORAGE_ID = "evir-shell";

export const SIDEBAR_PANEL_ID = "sidebar";
export const CHAT_PANEL_ID = "chat";
export const WORKSPACE_PANEL_ID = "workspace";

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 252;

export const WORKSPACE_MIN_WIDTH = 360;
export const WORKSPACE_DEFAULT_WIDTH = 520;
/** The workspace column never exceeds this share of the viewport (§28). */
export const WORKSPACE_MAX_VIEWPORT_RATIO = 0.7;
/** The inline conversation column never shrinks below this (§6-7). */
export const CONVERSATION_MIN_WIDTH = 460;

/**
 * JS mirrors of the shell.css drawer breakpoints. Below 820px the sidebar
 * renders as a fixed overlay drawer; below 1440px an open workspace renders
 * as a fixed right drawer (an inline third column would squeeze the
 * conversation under ~500px). In both modes the affected column is rendered
 * outside the resizable Group.
 */
export const SIDEBAR_OVERLAY_QUERY = "(max-width: 820px)";
export const WORKSPACE_DRAWER_QUERY = "(max-width: 1439.5px)";

const LIBRARY_KEY_PREFIX = "react-resizable-panels:";
const LEGACY_SIDEBAR_KEY = "evir-sidebar-width";
const LEGACY_WORKSPACE_KEY = "evir-workspace-width";

function shellLayoutStorageKey(panelIds: readonly string[]): string {
  return `${LIBRARY_KEY_PREFIX}${SHELL_LAYOUT_STORAGE_ID}:${panelIds.join(":")}`;
}

/** The library namespaces keys as `<prefix><id>:<panelId>:...`; parse the
 *  panel ids back out of a shell-owned key. Returns null for foreign keys. */
function parseShellLayoutKey(key: string): string[] | null {
  const prefix = `${LIBRARY_KEY_PREFIX}${SHELL_LAYOUT_STORAGE_ID}:`;
  if (!key.startsWith(prefix)) return null;
  const panelIds = key.slice(prefix.length).split(":").filter(Boolean);
  return panelIds.length > 0 ? panelIds : null;
}

function isLayout(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.entries(value).every(
      ([entryKey, entryValue]) => typeof entryKey === "string" && typeof entryValue === "number",
    )
  );
}

function readLegacyNumber(storage: Storage, key: string): number | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function clampWorkspaceWidth(width: number): number {
  const viewport = typeof window === "undefined" ? 1600 : window.innerWidth;
  // Two caps, mirroring the old store clamp: at most 70% of the viewport,
  // and never so wide that the chat column would fall below its minimum.
  const ratioMax = viewport * WORKSPACE_MAX_VIEWPORT_RATIO;
  const chatFloorMax = viewport - SIDEBAR_DEFAULT_WIDTH - CONVERSATION_MIN_WIDTH;
  const max = Math.max(WORKSPACE_MIN_WIDTH, Math.min(ratioMax, chatFloorMax));
  return Math.min(Math.max(width, WORKSPACE_MIN_WIDTH), Math.floor(max));
}

/** Legacy px width for a column, falling back to the documented defaults. */
function legacyWidthFor(panelId: string, storage: Storage): number {
  if (panelId === SIDEBAR_PANEL_ID) {
    const stored = readLegacyNumber(storage, LEGACY_SIDEBAR_KEY);
    return clampSidebarWidth(stored ?? SIDEBAR_DEFAULT_WIDTH);
  }
  if (panelId === WORKSPACE_PANEL_ID) {
    const stored = readLegacyNumber(storage, LEGACY_WORKSPACE_KEY);
    return clampWorkspaceWidth(stored ?? WORKSPACE_DEFAULT_WIDTH);
  }
  return 0;
}

function toPercentage(px: number, viewport: number): number {
  return Math.round((px / viewport) * 100 * 10000) / 10000;
}

/** Most recent widths saved for a different composition of the same shell,
 *  so e.g. the sidebar keeps its size when the workspace opens or closes. */
function readSharedLayout(
  panelIds: readonly string[],
  key: string,
  storage: Storage,
): Record<string, number> | null {
  let best: { overlap: number; values: Record<string, number> } | null = null;
  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (!candidateKey || candidateKey === key) continue;
    const candidateIds = parseShellLayoutKey(candidateKey);
    if (!candidateIds) continue;
    let values: Record<string, number>;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(candidateKey) ?? "");
      if (!isLayout(parsed)) continue;
      values = parsed;
    } catch {
      continue;
    }
    const overlap = candidateIds.filter((id) => panelIds.includes(id)).length;
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { overlap, values };
  }
  return best?.values ?? null;
}

/** Build a full `{ panelId: percentage }` layout for a composition without
 *  stored data: shared widths first, then legacy px migration, then defaults.
 *  The chat column is the flexible one and always takes the remainder. */
function synthesizeLayout(key: string, panelIds: readonly string[], storage: Storage): string {
  const viewport = typeof window === "undefined" ? 1280 : window.innerWidth;
  const layout: Record<string, number> = {};
  let assigned = 0;

  const shared = readSharedLayout(panelIds, key, storage);
  if (shared) {
    for (const panelId of panelIds) {
      const value = shared[panelId];
      if (panelId === CHAT_PANEL_ID || typeof value !== "number") continue;
      layout[panelId] = value;
      assigned += value;
    }
  }

  for (const panelId of panelIds) {
    if (panelId === CHAT_PANEL_ID || layout[panelId] !== undefined) continue;
    const percentage = toPercentage(legacyWidthFor(panelId, storage), viewport);
    layout[panelId] = percentage;
    assigned += percentage;
  }

  if (panelIds.includes(CHAT_PANEL_ID)) {
    const remainder = Math.round((100 - assigned) * 10000) / 10000;
    const floor = toPercentage(CONVERSATION_MIN_WIDTH, viewport);
    layout[CHAT_PANEL_ID] = Math.max(remainder, floor);
  }

  return JSON.stringify(layout);
}

/**
 * LayoutStorage adapter for `useDefaultLayout`. Reads fall back to a
 * synthesized layout (shared/legacy/defaults); writes persist and strip the
 * legacy px keys, completing the one-way migration.
 */
export function createShellLayoutStorage(target: Storage): LayoutStorage {
  return {
    getItem: (key: string): string | null => {
      const stored = target.getItem(key);
      if (stored !== null) return stored;
      const panelIds = parseShellLayoutKey(key);
      return panelIds ? synthesizeLayout(key, panelIds, target) : null;
    },
    setItem: (key: string, value: string): void => {
      target.setItem(key, value);
      target.removeItem(LEGACY_SIDEBAR_KEY);
      target.removeItem(LEGACY_WORKSPACE_KEY);
    },
  };
}

/** Storage key the library persists a composition's layout under. */
export function shellStorageKeyFor(panelIds: readonly string[]): string {
  return shellLayoutStorageKey(panelIds);
}
