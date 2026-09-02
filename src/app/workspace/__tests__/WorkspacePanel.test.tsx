// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePanel } from "../WorkspacePanel";
import { useWorkspacePanelStore } from "../../../features/workspace/workspace-panel-store";
import { useRunWorkspaceStore } from "../../../features/workspace/workspace-run-store";
import { useProjectStore } from "../../../features/projects/project-store";

let runtimeTarget: "web" | "desktop" = "desktop";
vi.mock("../../../runtime/use-runtime", () => ({
  getRuntime: () => ({ target: runtimeTarget }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values && values.count !== undefined ? `${key}:${values.count}` : key,
    i18n: { exists: () => false },
  }),
}));

let activeRoot: string | null = "/proj/root";
vi.mock("../../../features/workspace/workspace-bridge", () => ({
  useActiveWorkspaceRoot: () => activeRoot,
}));

vi.mock("../ChangesTab", () => ({ ChangesTab: () => <div data-testid="changes-tab" /> }));
vi.mock("../FilesTab", () => ({ FilesTab: () => <div data-testid="files-tab" /> }));
vi.mock("../PreviewTab", () => ({ PreviewTab: () => <div data-testid="preview-tab" /> }));
vi.mock("../BrowserTab", () => ({ BrowserTab: () => <div data-testid="browser-tab" /> }));

afterEach(cleanup);

function resetStores() {
  runtimeTarget = "desktop";
  useWorkspacePanelStore.setState({
    open: false,
    activeTab: "changes",
    activeResource: null,
    history: [],
    historyIndex: -1,
    pinnedKey: null,
    viewMode: "preview",
    overlayBlockers: null,
    browserContextUrl: null,
    conversationSnapshots: {},
  });
  useRunWorkspaceStore.setState({
    runId: null,
    conversationId: null,
    changes: [],
    outputs: [],
    browserActive: false,
  });
  useProjectStore.setState({ projects: [], currentProjectId: null });
}

describe("WorkspacePanel", () => {
  it("renders nothing while closed", () => {
    resetStores();
    const { container } = render(<WorkspacePanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing in the Web product even when panel state is open", () => {
    resetStores();
    runtimeTarget = "web";
    useWorkspacePanelStore.setState({ open: true });
    const { container } = render(<WorkspacePanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows all four tabs with a project and badge-free changes when empty", () => {
    resetStores();
    useWorkspacePanelStore.setState({ open: true });
    render(<WorkspacePanel />);
    expect(screen.getByRole("tab", { name: "workspace.changes" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "workspace.files" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "workspace.preview" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "workspace.browser" })).toBeTruthy();
    expect(document.querySelector(".workspace-tab-badge")).toBeNull();
  });

  it("hides project tabs in standalone chats (§54)", () => {
    resetStores();
    activeRoot = null;
    useWorkspacePanelStore.setState({ open: true, activeTab: "changes" });
    render(<WorkspacePanel />);
    expect(screen.queryByRole("tab", { name: "workspace.changes" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "workspace.files" })).toBeNull();
    expect(screen.getByRole("tab", { name: "workspace.preview" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "workspace.browser" })).toBeTruthy();
    // Active tab falls back from a project tab to preview.
    expect(screen.getByTestId("preview-tab")).toBeTruthy();
    activeRoot = "/proj/root";
  });

  it("switches tabs on click", () => {
    resetStores();
    useWorkspacePanelStore.setState({ open: true, activeTab: "changes" });
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "workspace.files" }));
    expect(useWorkspacePanelStore.getState().activeTab).toBe("files");
    expect(screen.getByTestId("files-tab")).toBeTruthy();
  });

  it("closes from the panel close button", () => {
    resetStores();
    useWorkspacePanelStore.setState({ open: true });
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "workspace.close" }));
    expect(useWorkspacePanelStore.getState().open).toBe(false);
  });
});
