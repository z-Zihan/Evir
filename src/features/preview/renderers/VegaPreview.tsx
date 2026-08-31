import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const MAX_VEGA_BYTES = 2_000_000;

interface VegaPreviewProps {
  source: string;
  mode: "vega" | "vega-lite";
}

type VegaEmbed = (typeof import("vega-embed"))["default"];

let vegaEmbedPromise: Promise<VegaEmbed> | null = null;
function loadVegaEmbed(): Promise<VegaEmbed> {
  vegaEmbedPromise ??= import("vega-embed").then((mod) => mod.default);
  return vegaEmbedPromise;
}

/**
 * Vega / Vega-Lite spec renderer. Specs are declarative JSON rendered by the
 * local vega runtime — no arbitrary JS execution. External URL data sources
 * are rejected up front (local-first + no silent network fetches).
 */
export function VegaPreview({ source, mode }: VegaPreviewProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (source.length > MAX_VEGA_BYTES) {
      setError(t("preview.tooLarge"));
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      let spec: unknown;
      try {
        spec = JSON.parse(source);
      } catch {
        setError(t("preview.malformedJson"));
        setBusy(false);
        return;
      }
      const externalUrl = JSON.stringify(spec).match(/"url"\s*:\s*"([^"]+)"/);
      if (externalUrl && !/^\s*(data:|blob:)/.test(externalUrl[1] ?? "")) {
        setError(t("preview.vegaExternalData"));
        setBusy(false);
        return;
      }
      try {
        const embed = await loadVegaEmbed();
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        await embed(host, spec as Parameters<VegaEmbed>[1], {
          mode: mode === "vega-lite" ? "vega-lite" : "vega",
          actions: false,
          defaultStyle: false,
        });
        if (!cancelled) setBusy(false);
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : "Vega render error");
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, mode, t]);

  if (error) {
    return (
      <div className="vega-error">
        <p className="preview-parse-error">{t("preview.vegaError")}</p>
        <p className="vega-error-detail">{error.slice(0, 300)}</p>
      </div>
    );
  }

  return (
    <div className="vega-preview" aria-label={t("preview.vegaChart")}>
      {/* Childless imperative host: React must never reconcile its children. */}
      <div className="vega-canvas-host" ref={hostRef} />
      {busy && <p className="preview-loading-text">{t("preview.rendering")}</p>}
    </div>
  );
}
