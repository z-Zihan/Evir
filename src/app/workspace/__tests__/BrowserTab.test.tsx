// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserTab } from "../BrowserTab";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }),
}));

const layoutUpdate = vi.fn<(input: Record<string, unknown>) => Promise<void>>();
layoutUpdate.mockResolvedValue(undefined);
vi.mock("../../../features/workspace/browser-panel-service", () => ({
  panelLayoutUpdate: (input: Record<string, unknown>) => layoutUpdate(input),
  panelTabList: vi.fn().mockResolvedValue([]),
  panelTabNew: vi.fn().mockResolvedValue({ id: 1, url: "", title: "", active: true }),
  panelTabActivate: vi.fn(),
  panelTabClose: vi.fn(),
  panelTabHistory: vi.fn(),
  panelTabNavigate: vi.fn(),
  subscribePanelTabs: vi.fn().mockResolvedValue(() => undefined),
  subscribePanelAnnotations: vi.fn().mockResolvedValue(() => undefined),
  panelAnnotate: vi.fn().mockResolvedValue(undefined),
  readScreenshotBase64: vi.fn(),
}));

vi.mock("../../../features/workspace/dev-server-service", () => ({
  detectDevScript: vi.fn().mockResolvedValue(null),
  devServerList: vi.fn().mockResolvedValue([]),
  devServerStart: vi.fn(),
  devServerStop: vi.fn(),
  subscribeDevServerStatus: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("../../../features/workspace/workspace-panel-store", () => ({
  useWorkspacePanelStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setBrowserContextUrl: vi.fn() }),
  selectOverlayBlocked: () => false,
}));

vi.mock("../../../features/workspace/workspace-run-store", () => ({
  useRunWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ outputs: [] }),
}));

vi.mock("../../../features/projects/project-store", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ projects: [], currentProjectId: null }),
}));

vi.mock("../../../features/workspace/workspace-bridge", () => ({
  useActiveWorkspaceRoot: () => null,
}));

vi.mock("../../useConfirmationDialog", () => ({
  useConfirmationDialog: () => ({
    requestConfirmation: vi.fn(),
    confirmationDialog: null,
  }),
}));

// jsdom has no ResizeObserver implementation.
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

afterEach(() => {
  cleanup();
  layoutUpdate.mockClear();
});

describe("BrowserTab geometry reporting", () => {
  it("re-reports the layout after a window resize", async () => {
    render(<BrowserTab />);
    await waitFor(() => expect(layoutUpdate).toHaveBeenCalled());

    const before = layoutUpdate.mock.calls.length;
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(layoutUpdate.mock.calls.length).toBeGreaterThan(before));

    const last = layoutUpdate.mock.calls.at(-1)?.[0] as {
      x: number;
      y: number;
      width: number;
      height: number;
      visible: boolean;
    };
    expect(last).toMatchObject({ x: 0, y: 0, visible: false });
  });
});
