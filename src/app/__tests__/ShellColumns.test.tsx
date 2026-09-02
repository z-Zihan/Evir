// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  ResizableGroup,
  ResizableHandle,
  ResizablePanel,
  useDefaultLayout,
} from "../../components/ui";
import {
  CHAT_PANEL_ID,
  CONVERSATION_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SHELL_LAYOUT_STORAGE_ID,
  SIDEBAR_PANEL_ID,
  createShellLayoutStorage,
  shellStorageKeyFor,
} from "../shell-layout";

const SIDEBAR_CHAT_KEY = shellStorageKeyFor([SIDEBAR_PANEL_ID, CHAT_PANEL_ID]);

const storage = createShellLayoutStorage(window.localStorage);

/**
 * Two-column slice of the App shell (sidebar + chat) wired exactly like
 * App.tsx: useDefaultLayout over the shell storage adapter, px constraints,
 * a preserve-pixel-size sidebar and a flexible chat panel.
 */
function ShellColumnsFixture() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: SHELL_LAYOUT_STORAGE_ID,
    panelIds: [SIDEBAR_PANEL_ID, CHAT_PANEL_ID],
    storage,
  });
  return (
    <ResizableGroup
      id={SHELL_LAYOUT_STORAGE_ID}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id={SIDEBAR_PANEL_ID}
        defaultSize={SIDEBAR_DEFAULT_WIDTH}
        minSize={SIDEBAR_MIN_WIDTH}
        maxSize={SIDEBAR_MAX_WIDTH}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div data-testid="sidebar-content" />
      </ResizablePanel>
      <ResizableHandle
        id="sidebar-handle"
        className="sidebar-resizer"
        aria-label="Resize sidebar"
      />
      <ResizablePanel id={CHAT_PANEL_ID} minSize={CONVERSATION_MIN_WIDTH}>
        <div data-testid="chat-content" />
      </ResizablePanel>
    </ResizableGroup>
  );
}

type Rect = { top: number; left: number; width: number; height: number };

/** jsdom has no layout engine; pin the geometry the library measures. The
 *  Group is 2000px wide (window-scale, so the px constraints don't clamp the
 *  migrated percentages), the sidebar 600px, the separator 1px. */
function installGeometry(): () => void {
  const rects: Record<string, Rect> = {
    [SHELL_LAYOUT_STORAGE_ID]: { top: 0, left: 0, width: 2000, height: 600 },
    [SIDEBAR_PANEL_ID]: { top: 0, left: 0, width: 600, height: 600 },
    "sidebar-handle": { top: 0, left: 600, width: 1, height: 600 },
    [CHAT_PANEL_ID]: { top: 0, left: 601, width: 1399, height: 600 },
  };
  const lookup = (element: Element): Rect | undefined => {
    const testId = element.getAttribute("data-testid");
    return testId ? rects[testId] : undefined;
  };
  const spies = [
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const rect = lookup(this) ?? { top: 0, left: 0, width: 0, height: 0 };
      return {
        x: rect.left,
        y: rect.top,
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => rect,
      };
    }),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return lookup(this)?.width ?? 0;
    }),
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return lookup(this)?.height ?? 0;
    }),
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return lookup(this)?.top ?? 0;
    }),
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return lookup(this)?.left ?? 0;
    }),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}

describe("shell columns (react-resizable-panels v4)", () => {
  let restoreGeometry: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    restoreGeometry = installGeometry();
  });

  afterEach(() => {
    cleanup();
    restoreGeometry?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a keyboard-accessible separator carrying the legacy hook class", () => {
    const { getByRole } = render(<ShellColumnsFixture />);
    const separator = getByRole("separator", { name: "Resize sidebar" });
    expect(separator.className).toContain("sidebar-resizer");
    expect(separator.getAttribute("data-separator")).not.toBeNull();
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.tabIndex).toBe(0);
  });

  it("restores a migrated legacy width as the sidebar flex-grow on mount", async () => {
    localStorage.setItem("evir-sidebar-width", "300");
    const { getByTestId } = render(<ShellColumnsFixture />);

    // 300px of a 1600px viewport.
    const sidebar = getByTestId(SIDEBAR_PANEL_ID);
    await waitFor(() => {
      expect(Number(sidebar.style.flexGrow)).toBeCloseTo(18.75, 2);
    });
    expect(Number(getByTestId(CHAT_PANEL_ID).style.flexGrow)).toBeCloseTo(81.25, 2);
  });

  it("persists the layout and strips the legacy keys once the Group mounts", async () => {
    localStorage.setItem("evir-sidebar-width", "300");
    render(<ShellColumnsFixture />);

    await waitFor(() => {
      expect(localStorage.getItem(SIDEBAR_CHAT_KEY)).not.toBeNull();
    });
    expect(localStorage.getItem("evir-sidebar-width")).toBeNull();
  });

  it("resets the sidebar to its default px size on separator double-click", async () => {
    localStorage.setItem("evir-sidebar-width", "300");
    const { getByRole, getByTestId } = render(<ShellColumnsFixture />);
    const sidebar = getByTestId(SIDEBAR_PANEL_ID);
    await waitFor(() => {
      expect(Number(sidebar.style.flexGrow)).toBeCloseTo(18.75, 2);
    });

    const separator = getByRole("separator", { name: "Resize sidebar" });
    fireEvent.doubleClick(separator, { clientX: 600, clientY: 300, detail: 2 });

    // defaultSize 252px of the mocked 2000px Group.
    await waitFor(() => {
      expect(Number(sidebar.style.flexGrow)).toBeCloseTo(12.6, 1);
    });
  });
});
