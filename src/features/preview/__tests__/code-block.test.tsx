// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlockView } from "../CodeBlockView";

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

vi.mock("../ArtifactPreview", () => ({
  ArtifactPreview: ({ rendererId }: { rendererId: string }) => (
    <div data-testid={`artifact-preview-${rendererId}`} />
  ),
}));

vi.mock("../PreviewOverlay", () => ({
  PreviewOverlay: () => <div data-testid="preview-overlay" />,
}));

afterEach(cleanup);

describe("CodeBlockView", () => {
  it("shows the language label and copies the exact code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CodeBlockView code={"const x = 1;"} language="ts" />);
    expect(screen.getByText("ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "chat.copyCode" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1;"));
  });

  it("offers a preview tab for previewable formats", () => {
    render(<CodeBlockView code={"flowchart TD\n  A --> B"} language="mermaid" />);
    expect(screen.getByRole("tab", { name: "preview.previewTab" })).toBeTruthy();
  });

  it("does not offer preview for plain code", () => {
    render(<CodeBlockView code={"fn main() {}"} language="rust" />);
    expect(screen.queryByRole("tab", { name: "preview.previewTab" })).toBeNull();
  });

  it("disables HTML preview while streaming and enables after completion", () => {
    const { rerender } = render(<CodeBlockView code={"<b>hi</b>"} language="html" streaming />);
    expect(screen.getByRole("tab", { name: "preview.previewTab" })).toHaveProperty(
      "disabled",
      true,
    );
    rerender(<CodeBlockView code={"<b>hi</b>"} language="html" streaming={false} />);
    expect(screen.getByRole("tab", { name: "preview.previewTab" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("auto-previews declarative formats after completion", () => {
    render(<CodeBlockView code={"flowchart TD\n  A --> B"} language="mermaid" />);
    expect(screen.getByTestId("artifact-preview-mermaid")).toBeTruthy();
  });

  it("never auto-previews untrusted HTML", () => {
    render(<CodeBlockView code={"<script>alert(1)</script>"} language="html" />);
    expect(screen.queryByTestId("artifact-preview-html")).toBeNull();
  });

  it("keeps code visible (no auto-preview) for diffs", () => {
    render(<CodeBlockView code={"@@ -1 +1 @@\n-old\n+new"} language="diff" />);
    expect(screen.queryByTestId("artifact-preview-diff")).toBeNull();
  });

  it("toggles word wrap", () => {
    const { container } = render(<CodeBlockView code={"x".repeat(100)} language="" />);
    fireEvent.click(screen.getByRole("button", { name: "preview.toggleWrap" }));
    const pre = container.querySelector(".code-block-pre");
    expect(pre?.classList.contains("wrap")).toBe(true);
  });

  it("exposes an expand button for previewable artifacts", () => {
    render(<CodeBlockView code={"flowchart TD\n  A --> B"} language="mermaid" />);
    fireEvent.click(screen.getByRole("button", { name: "preview.expand" }));
    expect(screen.getByTestId("preview-overlay")).toBeTruthy();
  });

  it("keeps expand disabled for small plain code blocks", () => {
    render(<CodeBlockView code={"let a = 1"} language="js" />);
    expect(screen.getByRole("button", { name: "preview.expand" })).toHaveProperty("disabled", true);
  });
});
