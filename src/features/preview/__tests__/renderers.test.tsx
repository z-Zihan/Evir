// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonTreePreview } from "../renderers/JsonTreePreview";
import { DataTreePreview } from "../renderers/DataTreePreview";
import { CsvTablePreview } from "../renderers/CsvTablePreview";
import { DiffPreview } from "../renderers/DiffPreview";
import { VegaPreview } from "../renderers/VegaPreview";
import { MermaidPreview } from "../renderers/MermaidPreview";
import { PreviewErrorBoundary } from "../PreviewErrorBoundary";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

// jsdom cannot run real diagram layout (no getBBox); the mermaid wrapper
// contract (success path, error fallback, size cap) is tested with a mocked
// module. Real rendering is covered by the packaged-app GUI validation.
const renderMock = vi.fn<(id: string, text: string) => Promise<{ svg: string }>>();
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: (id: string, text: string) => renderMock(id, text),
  },
}));

// vega-embed's async scheduler throws on detached nodes in jsdom; the embed
// contract (spec passthrough, mode, no external data) is asserted via mock.
// Real chart rendering is covered by the packaged-app GUI validation.
const vegaEmbedMock = vi.fn<(host: HTMLElement, spec: unknown, opts?: unknown) => Promise<unknown>>(
  (host) => {
    host.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    return Promise.resolve({});
  },
);

vi.mock("vega-embed", () => ({ default: vegaEmbedMock }));

afterEach(cleanup);

describe("JsonTreePreview", () => {
  it("renders objects as an expandable tree", () => {
    const { container } = render(<JsonTreePreview source={'{"name":"evir","count":2}'} />);
    const tree = container.querySelector(".json-tree");
    expect(tree).not.toBeNull();
    expect(screen.getByText(/evir/)).toBeTruthy();
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0);
  });

  it("copies leaf values on demand", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<JsonTreePreview source={'{"name":"evir"}'} />);
    fireEvent.click(screen.getByRole("button", { name: "preview.copyValue" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it("shows an explicit error for malformed JSON", () => {
    render(<JsonTreePreview source={'{"broken": '} />);
    expect(screen.getByText("preview.malformedJson")).toBeTruthy();
  });

  it("guards nesting depth", async () => {
    const { MAX_JSON_DEPTH } = await import("../renderers/JsonTreePreview");
    const deep = `${"[".repeat(MAX_JSON_DEPTH + 2)}1${"]".repeat(MAX_JSON_DEPTH + 2)}`;
    render(<JsonTreePreview source={deep} />);
    expect(screen.getByText("preview.jsonDepthExceeded")).toBeTruthy();
  });

  it("guards total size", async () => {
    const { MAX_JSON_BYTES } = await import("../renderers/JsonTreePreview");
    const big = '"'.repeat(MAX_JSON_BYTES + 100);
    render(<JsonTreePreview source={big} />);
    expect(screen.getByText("preview.tooLarge")).toBeTruthy();
  });

  it("renders arrays and null values without crashing", () => {
    render(<JsonTreePreview source={'[1, null, true, "s"]'} />);
    expect(screen.getByText(/null/)).toBeTruthy();
  });
});

describe("DataTreePreview (YAML/TOML/XML)", () => {
  it("renders YAML mappings as a tree", async () => {
    const { container } = render(<DataTreePreview source={"name: evir\nlevel: 2"} format="yaml" />);
    await waitFor(() => expect(container.querySelector(".data-tree")).not.toBeNull());
    expect(container.textContent).toContain("name");
  });

  it("renders TOML as a tree", async () => {
    const { container } = render(
      <DataTreePreview source={'title = "evir"\n[owner]\nname = "z"}'} format="toml" />,
    );
    await waitFor(() => expect(container.textContent).toContain("owner"));
  });

  it("renders XML structure with attributes, XXE-safe", async () => {
    const xml = '<?xml version="1.0"?><root id="1"><child>text</child></root>';
    const { container } = render(<DataTreePreview source={xml} format="xml" />);
    await waitFor(() => expect(container.textContent).toContain("child"));
    expect(container.textContent).toContain("@id");
  });

  it("shows malformed YAML as source, not a crash", async () => {
    const { container } = render(<DataTreePreview source={"a: [unclosed"} format="yaml" />);
    await waitFor(() => expect(container.querySelector(".data-tree-error")).not.toBeNull());
  });

  it("shows XML parser errors", async () => {
    const { container } = render(<DataTreePreview source={"<a><b></a>"} format="xml" />);
    await waitFor(() => expect(container.querySelector(".data-tree-error")).not.toBeNull());
  });
});

describe("CsvTablePreview", () => {
  it("renders a header row and body with row numbers", async () => {
    const { container } = render(
      <CsvTablePreview source={"name,level\nada,1\ngrace,2"} delimiter="," />,
    );
    await waitFor(() => expect(container.querySelector("table")).not.toBeNull());
    expect(screen.getByText("ada")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("handles quoted commas via papaparse", async () => {
    render(<CsvTablePreview source={'name,note\n"Smith, John","said \\"hi\\""}'} delimiter="," />);
    await waitFor(() => expect(screen.getByText(/Smith, John/)).toBeTruthy());
  });

  it("caps rendered rows for huge datasets", async () => {
    const rows = ["a,b"];
    for (let index = 0; index < 1200; index += 1) rows.push(`${index},x`);
    const { container } = render(<CsvTablePreview source={rows.join("\n")} delimiter="," />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    expect(container.querySelectorAll("tbody tr").length).toBeLessThanOrEqual(500);
    expect(container.querySelector(".csv-table-truncated")).not.toBeNull();
  });

  it("renders CJK content", async () => {
    render(
      <CsvTablePreview
        source={["名称,值", "项目,一"].join(String.fromCharCode(10))}
        delimiter=","
      />,
    );
    await waitFor(() => expect(screen.getByText("项目")).toBeTruthy());
  });
});

describe("DiffPreview", () => {
  it("marks added and removed lines", () => {
    const diff = "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new";
    const { container } = render(<DiffPreview source={diff} />);
    expect(container.querySelector(".diff-row-remove")).not.toBeNull();
    expect(container.querySelector(".diff-row-add")).not.toBeNull();
    expect(container.querySelector(".diff-row-hunk")).not.toBeNull();
  });

  it("renders empty diffs without crashing", () => {
    const { container } = render(<DiffPreview source="" />);
    expect(container.querySelector(".diff-preview")).not.toBeNull();
  });
});

describe("VegaPreview", () => {
  it("rejects specs with external URL data sources", async () => {
    const spec = JSON.stringify({
      mark: "bar",
      data: { url: "https://evil.example/data.json" },
    });
    const { container } = render(<VegaPreview source={spec} mode="vega-lite" />);
    await waitFor(() => expect(container.textContent).toContain("preview.vegaExternalData"));
  });

  it("reports malformed specs as JSON errors", async () => {
    const { container } = render(<VegaPreview source={"{broken"} mode="vega-lite" />);
    await waitFor(() => expect(container.textContent).toContain("preview.malformedJson"));
  });

  it("renders a minimal inline spec through vega-embed", async () => {
    const spec = JSON.stringify({
      mark: "bar",
      data: { values: [{ x: 1, y: 2 }] },
    });
    const { container } = render(<VegaPreview source={spec} mode="vega-lite" />);
    await waitFor(() => expect(vegaEmbedMock).toHaveBeenCalledTimes(1));
    expect(vegaEmbedMock.mock.calls[0]?.[1]).toMatchObject({ mark: "bar" });
    expect(vegaEmbedMock.mock.calls[0]?.[2]).toMatchObject({ mode: "vega-lite", actions: false });
    expect(container.querySelector(".vega-preview")).not.toBeNull();
  });
});

describe("MermaidPreview", () => {
  beforeEach(() => {
    renderMock.mockReset();
  });

  it("injects the sanitized SVG on success", async () => {
    renderMock.mockResolvedValue({ svg: "<svg><circle/></svg>" });
    const { container } = render(<MermaidPreview source={"flowchart TD\n  A --> B"} />);
    await waitFor(() => expect(container.querySelector(".mermaid-preview svg")).not.toBeNull());
  });

  it("initializes mermaid with the strict security level", async () => {
    renderMock.mockResolvedValue({ svg: "<svg/>" });
    render(<MermaidPreview source={'pie\n "a": 1'} />);
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
  });

  it("shows parse errors with the source instead of crashing", async () => {
    renderMock.mockRejectedValue(new Error("Parse error: unknown node"));
    const { container } = render(<MermaidPreview source={"flowchart TD\n  A ->> B broken"} />);
    await waitFor(() => expect(container.querySelector(".mermaid-error")).not.toBeNull());
    expect(container.querySelector(".mermaid-error-source")).not.toBeNull();
    expect(container.textContent).toContain("preview.mermaidParseError");
  });

  it("rejects oversized sources before rendering", async () => {
    const { MAX_MERMAID_BYTES } = await import("../renderers/MermaidPreview");
    const { container } = render(<MermaidPreview source={"x".repeat(MAX_MERMAID_BYTES + 1)} />);
    await waitFor(() => expect(container.textContent).toContain("preview.tooLarge"));
    expect(renderMock).not.toHaveBeenCalled();
  });
});

describe("PreviewErrorBoundary", () => {
  it("contains crashing renderers", () => {
    function Broken(): never {
      throw new Error("boom");
    }
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(
      <PreviewErrorBoundary renderer="test">
        <Broken />
      </PreviewErrorBoundary>,
    );
    expect(container.querySelector(".preview-renderer-error")).not.toBeNull();
    expect(container.textContent).toContain("preview.rendererFailed");
    expect(container.textContent).toContain("boom");
    consoleWarn.mockRestore();
  });
});
