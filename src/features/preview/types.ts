/**
 * Artifact preview trust model. Every artifact that enters a preview surface
 * carries a trust level; renderers must enforce the boundary that matches it.
 */
export type ArtifactTrustLevel =
  | "SAFE_TEXT"
  | "SAFE_MEDIA"
  | "DECLARATIVE_RENDER"
  | "UNTRUSTED_CODE"
  | "REMOTE_WEB"
  | "LOCAL_PROJECT_APP";

/** Identifies which renderer owns an artifact (fence language / extension). */
export type PreviewRendererId =
  | "html"
  | "svg"
  | "mermaid"
  | "graphviz"
  | "json"
  | "yaml"
  | "toml"
  | "xml"
  | "csv"
  | "tsv"
  | "vega"
  | "vega-lite"
  | "diff"
  | "markdown"
  | "markmap"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "gltf";

export interface ArtifactSource {
  /** Raw artifact content (fenced code body, file content, …). */
  content: string;
  /** Fence language or file extension that produced this artifact. */
  language: string;
  /** True while the model is still streaming this artifact. */
  streaming?: boolean;
}

export interface PreviewRendererDescriptor {
  id: PreviewRendererId;
  /** Human label shown in the preview header. */
  label: string;
  /** Fence languages (after alias normalization) this renderer claims. */
  fenceLanguages: readonly string[];
  /** File extensions this renderer claims (without leading dot). */
  extensions: readonly string[];
  /** MIME types this renderer claims. */
  mimeTypes: readonly string[];
  /** Higher wins when multiple renderers claim the same artifact. */
  priority: number;
  trustLevel: ArtifactTrustLevel;
  /** Whether the renderer can meaningfully update during streaming. */
  supportsStreaming: boolean;
  /** Cheap synchronous check (parseability heuristics) before rendering. */
  canPreview(source: ArtifactSource): boolean;
}
