import type { ArtifactSource, PreviewRendererDescriptor, PreviewRendererId } from "./types";

/**
 * Normalizes a fence language (case, common aliases) so renderers only need to
 * claim canonical ids. Unknown languages pass through lowercased.
 */
export function normalizeFenceLanguage(language: string): string {
  const raw = language.trim().toLowerCase();
  const aliases: Record<string, string> = {
    javascript: "js",
    jsx: "jsx",
    typescript: "ts",
    tsx: "tsx",
    mjs: "js",
    cjs: "js",
    node: "js",
    shell: "bash",
    sh: "bash",
    zsh: "bash",
    console: "bash",
    "shell-session": "bash",
    python: "py",
    python3: "py",
    rb: "ruby",
    golang: "go",
    rs: "rust",
    "c++": "cpp",
    "c#": "csharp",
    cs: "csharp",
    fsharp: "fsharp",
    "objective-c": "objc",
    yml: "yaml",
    json5: "json",
    jsonc: "json",
    ndjson: "json",
    "json-with-comments": "json",
    dot: "graphviz",
    graphviz: "graphviz",
    digraph: "graphviz",
    mermaid: "mermaid",
    mmd: "mermaid",
    "vega-lite": "vega-lite",
    vega: "vega",
    svg: "svg",
    html: "html",
    htm: "html",
    xhtml: "html",
    patch: "diff",
    udiff: "diff",
    diff: "diff",
    tsv: "tsv",
    tab_separated: "tsv",
    gltf: "gltf",
    glb: "gltf",
  };
  return aliases[raw] ?? raw;
}

function looksLikeJson(source: ArtifactSource): boolean {
  const trimmed = source.content.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function looksLikeYaml(source: ArtifactSource): boolean {
  if (looksLikeJson(source)) return false;
  return (
    /^\s*[^\s#][^:]*:(\s|$|\{)/m.test(source.content) && !source.content.trimStart().startsWith("<")
  );
}

function looksLikeMermaid(source: ArtifactSource): boolean {
  return /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|gitGraph|journey|quadrantChart|sankey-beta|xychart-beta|block-beta|architecture-beta|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|packet|rack)\b/i.test(
    source.content,
  );
}

function looksLikeDot(source: ArtifactSource): boolean {
  return (
    /^\s*(strict\s+)?(di)?graph(\s|\{)/i.test(source.content) ||
    /^\s*digraph\b/i.test(source.content)
  );
}

function looksLikeHtml(source: ArtifactSource): boolean {
  const trimmed = source.content.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    /<((html|head|body|div|section|article|main|header|footer|nav|span|p|a|img|script|style|link|meta|table|ul|ol|form|input|button|h[1-6])\b)/.test(
      trimmed,
    )
  );
}

function looksLikeSvg(source: ArtifactSource): boolean {
  return source.content.trimStart().toLowerCase().startsWith("<svg");
}

function looksLikeXml(source: ArtifactSource): boolean {
  const trimmed = source.content.trimStart();
  return (
    trimmed.startsWith("<?xml") ||
    (trimmed.startsWith("<") && !looksLikeHtml(source) && !looksLikeSvg(source))
  );
}

function looksLikeCsv(source: ArtifactSource): boolean {
  const firstLine = source.content.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine) return false;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  if (tabs > 0 && commas === 0) return false;
  return commas >= 1;
}

function looksLikeTsv(source: ArtifactSource): boolean {
  const firstLine = source.content.split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/\t/g) ?? []).length >= 1;
}

function looksLikeVegaLite(source: ArtifactSource): boolean {
  if (!looksLikeJson(source)) return false;
  const trimmed = source.content.trim();
  return (
    /^[{[]\s*"(?:\$schema|mark|encoding|data|layer|concat|vconcat|hconcat|facet|spec|repeat|params|transform|description)"\s*:/.test(
      trimmed.slice(0, 200),
    ) || /"\$schema"\s*:\s*"[^"]*vega-lite/.test(trimmed.slice(0, 500))
  );
}

function looksLikeVega(source: ArtifactSource): boolean {
  if (!looksLikeJson(source)) return false;
  const head = source.content.trim().slice(0, 500);
  return (
    /"\$schema"\s*:\s*"[^"]*vega\/v/.test(head) ||
    /^[{[]\s*"(?:scales|axes|marks|signals|projections|legends)"\s*:/.test(head)
  );
}

function looksLikeDiff(source: ArtifactSource): boolean {
  const lines = source.content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, 20);
  if (lines.length === 0) return false;
  let hunks = 0;
  let markers = 0;
  for (const line of lines) {
    if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line)) hunks += 1;
    if (/^[+-][^+-]/.test(line) || /^[+-]$/.test(line)) markers += 1;
  }
  return hunks > 0 || (markers > 0 && /^(-{3}|\+\+\+|diff --git|Index: )/.test(lines[0] ?? ""));
}

const DESCRIPTORS: readonly PreviewRendererDescriptor[] = [
  {
    id: "html",
    label: "HTML",
    fenceLanguages: ["html"],
    extensions: ["html", "htm", "xhtml"],
    mimeTypes: ["text/html"],
    priority: 30,
    trustLevel: "UNTRUSTED_CODE",
    supportsStreaming: false,
    canPreview: (source) => looksLikeHtml(source) || source.language === "html",
  },
  {
    id: "svg",
    label: "SVG",
    fenceLanguages: ["svg"],
    extensions: ["svg"],
    mimeTypes: ["image/svg+xml"],
    priority: 40,
    trustLevel: "SAFE_MEDIA",
    supportsStreaming: false,
    canPreview: (source) => looksLikeSvg(source) || source.language === "svg",
  },
  {
    id: "mermaid",
    label: "Mermaid",
    fenceLanguages: ["mermaid"],
    extensions: ["mmd", "mermaid"],
    mimeTypes: [],
    priority: 50,
    trustLevel: "DECLARATIVE_RENDER",
    supportsStreaming: true,
    canPreview: (source) => looksLikeMermaid(source) || source.language === "mermaid",
  },
  {
    id: "graphviz",
    label: "Graphviz",
    fenceLanguages: ["graphviz"],
    extensions: ["dot", "gv"],
    mimeTypes: ["text/vnd.graphviz"],
    priority: 50,
    trustLevel: "DECLARATIVE_RENDER",
    supportsStreaming: true,
    canPreview: (source) => looksLikeDot(source) || source.language === "graphviz",
  },
  {
    id: "vega-lite",
    label: "Vega-Lite",
    fenceLanguages: ["vega-lite"],
    extensions: [],
    mimeTypes: [],
    priority: 55,
    trustLevel: "DECLARATIVE_RENDER",
    supportsStreaming: false,
    canPreview: (source) => looksLikeVegaLite(source) || source.language === "vega-lite",
  },
  {
    id: "vega",
    label: "Vega",
    fenceLanguages: ["vega"],
    extensions: [],
    mimeTypes: [],
    priority: 45,
    trustLevel: "DECLARATIVE_RENDER",
    supportsStreaming: false,
    canPreview: (source) => looksLikeVega(source) || source.language === "vega",
  },
  {
    id: "json",
    label: "JSON",
    fenceLanguages: ["json"],
    extensions: ["json", "jsonc", "json5", "ndjson"],
    mimeTypes: ["application/json"],
    priority: 20,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) => looksLikeJson(source) || source.language === "json",
  },
  {
    id: "yaml",
    label: "YAML",
    fenceLanguages: ["yaml"],
    extensions: ["yaml", "yml"],
    mimeTypes: ["text/yaml", "application/yaml"],
    priority: 20,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) => looksLikeYaml(source) || source.language === "yaml",
  },
  {
    id: "toml",
    label: "TOML",
    fenceLanguages: ["toml"],
    extensions: ["toml"],
    mimeTypes: ["text/toml"],
    priority: 25,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) =>
      /^\s*[A-Za-z0-9_."'-]+\s*=\s*\S/m.test(source.content) ||
      /^\s*\[[A-Za-z0-9_. -]+\]\s*$/m.test(source.content) ||
      source.language === "toml",
  },
  {
    id: "xml",
    label: "XML",
    fenceLanguages: ["xml"],
    extensions: ["xml", "xsd", "svg-less"],
    mimeTypes: ["text/xml", "application/xml"],
    priority: 25,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) => looksLikeXml(source) || source.language === "xml",
  },
  {
    id: "csv",
    label: "CSV",
    fenceLanguages: ["csv"],
    extensions: ["csv"],
    mimeTypes: ["text/csv"],
    priority: 20,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) => looksLikeCsv(source) || source.language === "csv",
  },
  {
    id: "tsv",
    label: "TSV",
    fenceLanguages: ["tsv"],
    extensions: ["tsv", "tab"],
    mimeTypes: ["text/tab-separated-values"],
    priority: 30,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) => looksLikeTsv(source) || source.language === "tsv",
  },
  {
    id: "diff",
    label: "Diff",
    fenceLanguages: ["diff"],
    extensions: ["diff", "patch"],
    mimeTypes: ["text/x-diff", "text/x-patch"],
    priority: 35,
    trustLevel: "SAFE_TEXT",
    supportsStreaming: false,
    canPreview: (source) => looksLikeDiff(source) || source.language === "diff",
  },
  {
    id: "markmap",
    label: "Markmap",
    fenceLanguages: ["markmap", "mindmap"],
    extensions: [],
    mimeTypes: [],
    priority: 50,
    trustLevel: "DECLARATIVE_RENDER",
    supportsStreaming: false,
    canPreview: (source) => source.language === "markmap" || source.language === "mindmap",
  },
];

const BY_FENCE = new Map<string, PreviewRendererDescriptor>();
const BY_EXTENSION = new Map<string, PreviewRendererDescriptor>();
const BY_MIME = new Map<string, PreviewRendererDescriptor>();
const BY_ID = new Map<PreviewRendererId, PreviewRendererDescriptor>();

for (const descriptor of [...DESCRIPTORS].sort((a, b) => b.priority - a.priority)) {
  BY_ID.set(descriptor.id, descriptor);
  for (const lang of descriptor.fenceLanguages) {
    if (!BY_FENCE.has(lang)) BY_FENCE.set(lang, descriptor);
  }
  for (const ext of descriptor.extensions) {
    if (!BY_EXTENSION.has(ext)) BY_EXTENSION.set(ext, descriptor);
  }
  for (const mime of descriptor.mimeTypes) {
    if (!BY_MIME.has(mime)) BY_MIME.set(mime, descriptor);
  }
}

export class PreviewRegistry {
  list(): readonly PreviewRendererDescriptor[] {
    return DESCRIPTORS;
  }

  byId(id: PreviewRendererId): PreviewRendererDescriptor | undefined {
    return BY_ID.get(id);
  }

  /** Finds the renderer claiming an explicit fence language. */
  forLanguage(language: string): PreviewRendererDescriptor | undefined {
    return BY_FENCE.get(normalizeFenceLanguage(language));
  }

  forExtension(extension: string): PreviewRendererDescriptor | undefined {
    return BY_EXTENSION.get(extension.replace(/^\./, "").toLowerCase());
  }

  forMimeType(mime: string): PreviewRendererDescriptor | undefined {
    return BY_MIME.get(mime.split(";")[0]?.trim().toLowerCase() ?? "");
  }

  /**
   * Best-effort match for an artifact: explicit fence language first, then
   * content sniffing across all renderers by priority.
   */
  detect(source: ArtifactSource): PreviewRendererDescriptor | null {
    const explicit = this.forLanguage(source.language);
    if (explicit && explicit.canPreview(source)) return explicit;
    const candidates = [...DESCRIPTORS]
      .filter((descriptor) => descriptor.id !== explicit?.id)
      .sort((a, b) => b.priority - a.priority);
    for (const descriptor of candidates) {
      if (descriptor.canPreview(source)) return descriptor;
    }
    return null;
  }
}

export const previewRegistry = new PreviewRegistry();
