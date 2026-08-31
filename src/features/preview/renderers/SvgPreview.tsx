import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface SvgPreviewProps {
  source: string;
}

export const MAX_SVG_BYTES = 2_000_000;

/**
 * Renders model-generated SVG in an image context (`<img>` with a blob URL).
 * Image-context SVG never executes scripts, external references or event
 * handlers, which is exactly the SAFE_MEDIA boundary we want by default.
 */
export function SvgPreview({ source }: SvgPreviewProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (source.length > MAX_SVG_BYTES) return;
    const blob = new Blob([source], { type: "image/svg+xml" });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source]);

  if (!url) {
    return <p className="preview-fallback-text">{t("preview.tooLarge")}</p>;
  }

  return (
    <div className="svg-preview">
      <img src={url} alt={t("preview.svgImage")} />
    </div>
  );
}
