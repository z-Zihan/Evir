import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Mermaid sources beyond this size render as source instead of a diagram. */
export const MAX_MERMAID_BYTES = 200_000;

interface MermaidPreviewProps {
  source: string;
}

type MermaidModule = (typeof import("mermaid"))["default"];

let mermaidModulePromise: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  mermaidModulePromise ??= import("mermaid").then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      // Strict: HTML labels are escaped and click callbacks disabled.
      securityLevel: "strict",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
    });
    return mod.default;
  });
  return mermaidModulePromise;
}

let renderCounter = 0;

/**
 * Renders Mermaid declarative diagrams. `securityLevel: "strict"` makes
 * mermaid sanitize its SVG output (DOMPurify) and disables interactions, so
 * injecting the produced SVG is safe. Parse failures surface the source plus
 * an explicit error, never a crash.
 */
export function MermaidPreview({ source }: MermaidPreviewProps) {
  const { t } = useTranslation();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const tooLarge = source.length > MAX_MERMAID_BYTES;

  useEffect(() => {
    if (tooLarge) return;
    let cancelled = false;
    setError(null);
    setSvg(null);
    void loadMermaid()
      .then((mermaid) => mermaid.render(`evir-mermaid-${++renderCounter}`, source))
      .then(
        ({ svg: output }) => {
          if (!cancelled) setSvg(output);
        },
        (renderError: unknown) => {
          if (!cancelled)
            setError(renderError instanceof Error ? renderError.message : "Parse error");
        },
      );
    return () => {
      cancelled = true;
    };
  }, [source, tooLarge, t]);

  if (tooLarge) {
    return <p className="preview-fallback-text">{t("preview.tooLarge")}</p>;
  }

  if (error) {
    return (
      <div className="mermaid-error">
        <p className="preview-parse-error">{t("preview.mermaidParseError")}</p>
        <pre className="mermaid-error-source">{source.slice(0, 4000)}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-preview"
      aria-label={t("preview.mermaidDiagram")}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      data-placeholder={svg ? undefined : t("preview.rendering")}
    />
  );
}
