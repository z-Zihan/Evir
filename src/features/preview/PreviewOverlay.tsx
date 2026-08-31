import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Minimize2 } from "lucide-react";
import { ArtifactPreview } from "./ArtifactPreview";
import type { PreviewRendererId } from "./types";

interface PreviewOverlayProps {
  /** Renderer to expand; omit to expand plain (non-previewable) code. */
  rendererId?: PreviewRendererId;
  source: string;
  title: string;
  onClose: () => void;
}

/** Full-window preview panel for large artifacts (Esc closes, focus trapped). */
export function PreviewOverlay({ rendererId, source, title, onClose }: PreviewOverlayProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header className="preview-overlay-header">
        <span className="preview-overlay-title">{title}</span>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label={t("common.close")}
          className="preview-overlay-close"
        >
          <Minimize2 size={14} />
          {t("preview.collapse")}
        </button>
      </header>
      <div className="preview-overlay-body">
        {rendererId ? (
          <ArtifactPreview rendererId={rendererId} source={source} />
        ) : (
          <pre className="code-block-pre wrap">
            <code>{source}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
