import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const MAX_DOT_BYTES = 400_000;

interface GraphvizPreviewProps {
  source: string;
}

type VizInstance = Awaited<ReturnType<(typeof import("@viz-js/viz"))["instance"]>>;
let vizPromise: Promise<VizInstance> | null = null;

function loadViz(): Promise<VizInstance> {
  vizPromise ??= import("@viz-js/viz").then(({ instance }) => instance());
  return vizPromise;
}

/**
 * Graphviz/DOT renderer using the WASM viz.js build (no system Graphviz
 * dependency). renderSVGElement returns a sanitized DOM element that is
 * appended directly — no string/innerHTML path for untrusted input.
 */
export function GraphvizPreview({ source }: GraphvizPreviewProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (source.length > MAX_DOT_BYTES) {
      setError(t("preview.tooLarge"));
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    void loadViz()
      .then((viz) => viz.renderSVGElement(source))
      .then(
        (element) => {
          if (cancelled) return;
          const host = hostRef.current;
          if (!host) return;
          host.replaceChildren(element);
          element.setAttribute("width", "100%");
          element.setAttribute("height", "auto");
          setBusy(false);
        },
        (renderError: unknown) => {
          if (cancelled) return;
          setError(renderError instanceof Error ? renderError.message : "DOT parse error");
          setBusy(false);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [source, t]);

  if (error) {
    return (
      <div className="graphviz-error">
        <p className="preview-parse-error">{t("preview.dotParseError")}</p>
        <pre className="graphviz-error-source">{source.slice(0, 4000)}</pre>
      </div>
    );
  }

  return (
    <div className="graphviz-preview" aria-label={t("preview.graphvizDiagram")}>
      {/* Childless imperative host: React must never reconcile its children. */}
      <div className="graphviz-canvas-host" ref={hostRef} />
      {busy && <p className="preview-loading-text">{t("preview.rendering")}</p>}
    </div>
  );
}
