// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlockView } from "../CodeBlockView";
import { useWorkspacePanelStore } from "../../workspace/workspace-panel-store";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

// Keep Shiki out of these tests: plain <pre> fallback renders synchronously.
vi.mock("../use-shiki", async (importOriginal) => {
  const original = await importOriginal<typeof import("../use-shiki")>();
  return {
    ...original,
    useShikiHighlight: () => ({ html: null, error: false }),
  };
});

vi.mock("../../workspace/workspace-services", () => ({
  saveArtifact: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

function resetPanelStore() {
  useWorkspacePanelStore.setState({
    open: false,
    activeTab: "changes",
    activeResource: null,
    history: [],
    historyIndex: -1,
    viewMode: "preview",
  });
}

describe("CodeBlockView", () => {
  it("shows the language label and copies the exact code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CodeBlockView code={"const x = 1;"} language="ts" />);
    expect(screen.getByText("ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "chat.copyCode" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1;"));
  });

  it("offers an open-in-workspace action for previewable formats", () => {
    resetPanelStore();
    render(<CodeBlockView code={"flowchart TD\n  A --> B"} language="mermaid" />);
    const button = screen.getByRole("button", { name: "preview.openInWorkspace" });
    expect(button).toBeTruthy();
    expect(button).toHaveProperty("disabled", false);
  });

  it("never renders an inline artifact preview anymore", () => {
    render(<CodeBlockView code={"flowchart TD\n  A --> B"} language="mermaid" />);
    expect(document.querySelector(".artifact-preview")).toBeNull();
    expect(document.querySelector('[data-testid^="artifact-preview-"]')).toBeNull();
  });

  it("does not offer the workspace action while streaming", () => {
    render(<CodeBlockView code={"<b>hi</b>"} language="html" streaming />);
    expect(screen.queryByRole("button", { name: "preview.openInWorkspace" })).toBeNull();
  });

  it("opening a previewable artifact routes the workspace panel to preview", async () => {
    resetPanelStore();
    render(<CodeBlockView code={"flowchart TD\n  A --> B"} language="mermaid" />);
    fireEvent.click(screen.getByRole("button", { name: "preview.openInWorkspace" }));
    // saveArtifact resolves asynchronously before openResource runs.
    await waitFor(() => expect(useWorkspacePanelStore.getState().open).toBe(true));
    const state = useWorkspacePanelStore.getState();
    expect(state.activeTab).toBe("preview");
    expect(state.activeResource?.kind).toBe("artifact");
    expect(state.viewMode).toBe("preview");
  });

  it("toggles word wrap", () => {
    const { container } = render(<CodeBlockView code={"x".repeat(100)} language="" />);
    fireEvent.click(screen.getByRole("button", { name: "preview.toggleWrap" }));
    const pre = container.querySelector(".code-block-pre");
    expect(pre?.classList.contains("wrap")).toBe(true);
  });

  it("keeps code visible as the only body (no inline preview of untrusted HTML)", () => {
    render(<CodeBlockView code={"<script>alert(1)</script>"} language="html" />);
    expect(document.querySelector('[data-testid^="artifact-preview-"]')).toBeNull();
    expect(screen.getByRole("button", { name: "preview.openInWorkspace" })).toBeTruthy();
  });

  it("plain code blocks still get the workspace action after completion", () => {
    resetPanelStore();
    render(<CodeBlockView code={"let a = 1"} language="js" />);
    expect(screen.getByRole("button", { name: "preview.openInWorkspace" })).toBeTruthy();
  });
});
