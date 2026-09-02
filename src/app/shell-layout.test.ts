// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PANEL_ID,
  CONVERSATION_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SHELL_LAYOUT_STORAGE_ID,
  SIDEBAR_PANEL_ID,
  WORKSPACE_DEFAULT_WIDTH,
  WORKSPACE_MIN_WIDTH,
  WORKSPACE_PANEL_ID,
  createShellLayoutStorage,
  shellStorageKeyFor,
} from "./shell-layout";

const SIDEBAR_CHAT_KEY = shellStorageKeyFor([SIDEBAR_PANEL_ID, CHAT_PANEL_ID]);
const THREE_COLUMN_KEY = shellStorageKeyFor([SIDEBAR_PANEL_ID, CHAT_PANEL_ID, WORKSPACE_PANEL_ID]);

function layoutOf(raw: string | null): Record<string, number> {
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as Record<string, number>;
}

describe("shell layout storage", () => {
  beforeEach(() => {
    localStorage.clear();
    // Fixed viewport so percentage expectations are exact (1600px wide).
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
  });

  it("builds library-namespaced keys per composition", () => {
    expect(SIDEBAR_CHAT_KEY).toBe(
      `react-resizable-panels:${SHELL_LAYOUT_STORAGE_ID}:${SIDEBAR_PANEL_ID}:${CHAT_PANEL_ID}`,
    );
  });

  it("ignores keys outside the shell namespace", () => {
    const storage = createShellLayoutStorage(localStorage);
    expect(storage.getItem("react-resizable-panels:other-app:sidebar:chat")).toBeNull();
    expect(storage.getItem(`react-resizable-panels:${SHELL_LAYOUT_STORAGE_ID}`)).toBeNull();
    expect(storage.getItem("unrelated")).toBeNull();
  });

  it("migrates legacy px widths into a percentage layout on first read", () => {
    localStorage.setItem("evir-sidebar-width", "300");
    localStorage.setItem("evir-workspace-width", "600");
    const storage = createShellLayoutStorage(localStorage);

    const layout = layoutOf(storage.getItem(THREE_COLUMN_KEY));
    expect(layout[SIDEBAR_PANEL_ID]).toBeCloseTo((300 / 1600) * 100, 4);
    expect(layout[WORKSPACE_PANEL_ID]).toBeCloseTo((600 / 1600) * 100, 4);
    expect(layout[CHAT_PANEL_ID]).toBeCloseTo(100 - (300 / 1600) * 100 - (600 / 1600) * 100, 4);
  });

  it("migrates legacy widths for a two-column composition too", () => {
    localStorage.setItem("evir-sidebar-width", "300");
    const storage = createShellLayoutStorage(localStorage);

    const layout = layoutOf(storage.getItem(SIDEBAR_CHAT_KEY));
    expect(layout[SIDEBAR_PANEL_ID]).toBeCloseTo((300 / 1600) * 100, 4);
    expect(layout[CHAT_PANEL_ID]).toBeCloseTo(100 - (300 / 1600) * 100, 4);
    expect(Object.keys(layout)).toEqual([SIDEBAR_PANEL_ID, CHAT_PANEL_ID]);
  });

  it("falls back to the documented defaults without legacy values", () => {
    const storage = createShellLayoutStorage(localStorage);

    const layout = layoutOf(storage.getItem(THREE_COLUMN_KEY));
    expect(layout[SIDEBAR_PANEL_ID]).toBeCloseTo((SIDEBAR_DEFAULT_WIDTH / 1600) * 100, 4);
    expect(layout[WORKSPACE_PANEL_ID]).toBeCloseTo((WORKSPACE_DEFAULT_WIDTH / 1600) * 100, 4);
    expect(layout[CHAT_PANEL_ID]).toBeCloseTo(
      100 - (SIDEBAR_DEFAULT_WIDTH / 1600) * 100 - (WORKSPACE_DEFAULT_WIDTH / 1600) * 100,
      4,
    );
  });

  it("clamps out-of-range legacy sidebar widths into the allowed range", () => {
    localStorage.setItem("evir-sidebar-width", "800");
    const tooWide = layoutOf(createShellLayoutStorage(localStorage).getItem(SIDEBAR_CHAT_KEY));
    expect(tooWide[SIDEBAR_PANEL_ID]).toBeCloseTo((SIDEBAR_MAX_WIDTH / 1600) * 100, 4);

    localStorage.setItem("evir-sidebar-width", "50");
    const tooNarrow = layoutOf(createShellLayoutStorage(localStorage).getItem(SIDEBAR_CHAT_KEY));
    expect(tooNarrow[SIDEBAR_PANEL_ID]).toBeCloseTo((SIDEBAR_MIN_WIDTH / 1600) * 100, 4);
  });

  it("clamps legacy workspace widths to the viewport and chat floor caps", () => {
    localStorage.setItem("evir-workspace-width", "100");
    const tooNarrow = layoutOf(createShellLayoutStorage(localStorage).getItem(THREE_COLUMN_KEY));
    expect(tooNarrow[WORKSPACE_PANEL_ID]).toBeCloseTo((WORKSPACE_MIN_WIDTH / 1600) * 100, 4);

    // 1600px request with a 1600px viewport: capped by the 70% viewport ratio
    // and by keeping the chat column above its 460px minimum.
    localStorage.setItem("evir-workspace-width", "1600");
    const tooWide = layoutOf(createShellLayoutStorage(localStorage).getItem(THREE_COLUMN_KEY));
    const capped = Math.min(1600 * 0.7, 1600 - SIDEBAR_DEFAULT_WIDTH - CONVERSATION_MIN_WIDTH);
    expect(tooWide[WORKSPACE_PANEL_ID]).toBeCloseTo((capped / 1600) * 100, 4);
  });

  it("persists writes and deletes the legacy px keys (write-through migration)", () => {
    localStorage.setItem("evir-sidebar-width", "300");
    localStorage.setItem("evir-workspace-width", "600");
    const storage = createShellLayoutStorage(localStorage);

    // Reading synthesizes but does not touch the legacy keys yet.
    storage.getItem(THREE_COLUMN_KEY);
    expect(localStorage.getItem("evir-sidebar-width")).toBe("300");

    storage.setItem(
      THREE_COLUMN_KEY,
      JSON.stringify({ sidebar: 18.75, chat: 49.25, workspace: 32 }),
    );
    expect(localStorage.getItem("evir-sidebar-width")).toBeNull();
    expect(localStorage.getItem("evir-workspace-width")).toBeNull();
    expect(JSON.parse(localStorage.getItem(THREE_COLUMN_KEY)!)).toEqual({
      sidebar: 18.75,
      chat: 49.25,
      workspace: 32,
    });
  });

  it("restores persisted layouts across adapter instances (restart)", () => {
    const first = createShellLayoutStorage(localStorage);
    first.setItem(SIDEBAR_CHAT_KEY, JSON.stringify({ sidebar: 18.75, chat: 81.25 }));

    const second = createShellLayoutStorage(localStorage);
    expect(JSON.parse(second.getItem(SIDEBAR_CHAT_KEY)!)).toEqual({
      sidebar: 18.75,
      chat: 81.25,
    });
  });

  it("shares column widths across compositions of the same shell", () => {
    const storage = createShellLayoutStorage(localStorage);
    storage.setItem(SIDEBAR_CHAT_KEY, JSON.stringify({ sidebar: 20, chat: 80 }));

    const layout = layoutOf(storage.getItem(THREE_COLUMN_KEY));
    expect(layout[SIDEBAR_PANEL_ID]).toBe(20);
    expect(layout[WORKSPACE_PANEL_ID]).toBeCloseTo((WORKSPACE_DEFAULT_WIDTH / 1600) * 100, 4);
    expect(layout[CHAT_PANEL_ID]).toBeCloseTo(100 - 20 - (WORKSPACE_DEFAULT_WIDTH / 1600) * 100, 4);
  });
});
