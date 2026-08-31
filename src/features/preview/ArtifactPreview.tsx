import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { PreviewRendererId } from "./types";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";

const HtmlPreview = lazy(() =>
  import("./renderers/HtmlPreview").then((m) => ({ default: m.HtmlPreview })),
);
const SvgPreview = lazy(() =>
  import("./renderers/SvgPreview").then((m) => ({ default: m.SvgPreview })),
);
const MermaidPreview = lazy(() =>
  import("./renderers/MermaidPreview").then((m) => ({ default: m.MermaidPreview })),
);
const GraphvizPreview = lazy(() =>
  import("./renderers/GraphvizPreview").then((m) => ({ default: m.GraphvizPreview })),
);
const JsonTreePreview = lazy(() =>
  import("./renderers/JsonTreePreview").then((m) => ({ default: m.JsonTreePreview })),
);
const DataTreePreview = lazy(() =>
  import("./renderers/DataTreePreview").then((m) => ({ default: m.DataTreePreview })),
);
const CsvTablePreview = lazy(() =>
  import("./renderers/CsvTablePreview").then((m) => ({ default: m.CsvTablePreview })),
);
const VegaPreview = lazy(() =>
  import("./renderers/VegaPreview").then((m) => ({ default: m.VegaPreview })),
);
const DiffPreview = lazy(() =>
  import("./renderers/DiffPreview").then((m) => ({ default: m.DiffPreview })),
);
const PdfPreview = lazy(() =>
  import("./renderers/PdfPreview").then((m) => ({ default: m.PdfPreview })),
);

export interface ArtifactPreviewProps {
  rendererId: PreviewRendererId;
  source: string;
  /** Extra context for renderers that need it (e.g. PDF base64 data). */
  data?: string;
}

function RendererBody({ rendererId, source, data }: ArtifactPreviewProps) {
  switch (rendererId) {
    case "html":
      return <HtmlPreview source={source} />;
    case "svg":
      return <SvgPreview source={source} />;
    case "mermaid":
      return <MermaidPreview source={source} />;
    case "graphviz":
      return <GraphvizPreview source={source} />;
    case "json":
      return <JsonTreePreview source={source} />;
    case "yaml":
      return <DataTreePreview source={source} format="yaml" />;
    case "toml":
      return <DataTreePreview source={source} format="toml" />;
    case "xml":
      return <DataTreePreview source={source} format="xml" />;
    case "csv":
      return <CsvTablePreview source={source} delimiter="," />;
    case "tsv":
      return <CsvTablePreview source={source} delimiter={"\t"} />;
    case "vega":
      return <VegaPreview source={source} mode="vega" />;
    case "vega-lite":
      return <VegaPreview source={source} mode="vega-lite" />;
    case "diff":
      return <DiffPreview source={source} />;
    case "pdf":
      return data ? <PdfPreview data={data} /> : null;
    default:
      return null;
  }
}

/**
 * Single entry point for artifact previews: wraps the lazily-imported
 * renderer in its own error boundary and suspense fallback so any renderer
 * failure or slow chunk load stays contained to this artifact.
 */
export function ArtifactPreview(props: ArtifactPreviewProps) {
  const { t } = useTranslation();
  return (
    <div className="artifact-preview">
      <PreviewErrorBoundary renderer={props.rendererId}>
        <Suspense fallback={<p className="preview-loading-text">{t("preview.loading")}</p>}>
          <RendererBody {...props} />
        </Suspense>
      </PreviewErrorBoundary>
    </div>
  );
}
